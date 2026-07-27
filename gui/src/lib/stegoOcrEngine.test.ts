import { describe, expect, it, vi } from "vitest";
import { OEM, PSM } from "tesseract.js";
import type { StegoOcrCandidate } from "./stegoOcr";
import { expandOcrTextBand, findOcrTextBands, normalizeOcrBandPixels, OfflineStegoOcrEngine, offlineOcrAssetUrls, shouldCropOcrTextBands } from "./stegoOcrEngine";

const candidate: StegoOcrCandidate = {
  id: "visual:frame",
  label: "frame",
  mediaType: "image/png",
  bytes: Uint8Array.of(137, 80, 78, 71),
};

function recognitionData(text: string, confidenceByIndex: Record<number, number> = {}) {
  return {
    text,
    confidence: 80,
    blocks: [{
      paragraphs: [{
        lines: [{
          words: [{
            symbols: Array.from(text, (character, index) => ({
              text: character,
              confidence: confidenceByIndex[index] ?? 90,
              bbox: { x0: index * 8, y0: 0, x1: index * 8 + 7, y1: 16 },
            })),
          }],
        }],
      }],
    }],
  };
}

describe("offline OCR engine", () => {
  it("finds separate text rows in a foreground mask", () => {
    const width = 8;
    const mask = new Uint8Array(width * 9);
    for (const row of [1, 2, 5, 6, 7]) mask.fill(1, row * width + 2, row * width + 6);

    expect(findOcrTextBands(mask, width, 9)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 8 },
    ]);
  });

  it("stretches a low-contrast text band against its local background", () => {
    const pixels = Uint8ClampedArray.of(
      255, 255, 255, 255,
      255, 255, 0, 255,
    );

    expect(Array.from(normalizeOcrBandPixels(pixels))).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
  });

  it("crops one sparse text band but not a band filling the image", () => {
    expect(shouldCropOcrTextBands([{ start: 250, end: 260 }], 300)).toBe(true);
    expect(shouldCropOcrTextBands([{ start: 2, end: 298 }], 300)).toBe(false);
  });

  it("keeps one text-height of vertical whitespace around a tiny OCR row", () => {
    expect(expandOcrTextBand({ start: 36, end: 42 }, 50)).toEqual({ start: 30, end: 48 });
    expect(expandOcrTextBand({ start: 2, end: 8 }, 50)).toEqual({ start: 0, end: 14 });
  });
  it("resolves every worker, core and language URL under the packaged app origin", () => {
    const urls = offlineOcrAssetUrls("http://localhost:1420/app/index.html");

    expect(urls).toEqual({
      workerPath: "http://localhost:1420/app/ocr/worker.min.js",
      corePath: "http://localhost:1420/app/ocr/core",
      langPath: "http://localhost:1420/app/ocr/lang",
    });
    expect(JSON.stringify(urls)).not.toMatch(/cdn|jsdelivr|https:/i);
  });

  it("creates one LSTM worker, recognizes candidates and terminates it", async () => {
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: "ctfshow{ocr_engine}", confidence: 91 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const blockWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: "ctfshow{block_fallback}", confidence: 50 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce(blockWorker);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(factory).toHaveBeenNthCalledWith(1, "eng", OEM.LSTM_ONLY, expect.objectContaining({
      workerPath: "http://localhost:1420/ocr/worker.min.js",
      corePath: "http://localhost:1420/ocr/core",
      langPath: "http://localhost:1420/ocr/lang",
      workerBlobURL: false,
      gzip: true,
    }));
    expect(worker.setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }));
    expect(worker.recognize).toHaveBeenCalledWith(expect.any(Blob), {}, { text: true, blocks: true });
    // Primary worker has confidence 91 > 40, so block worker should NOT be called
    expect(blockWorker.recognize).not.toHaveBeenCalled();
    expect(result).toEqual({ text: "ctfshow{ocr_engine}", confidence: 91 });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    // Block worker was never created (high confidence → no fallback needed)
    // so its terminate was never called
    expect(blockWorker.terminate).not.toHaveBeenCalled();
  });

  it("falls back to block worker when primary has low confidence", async () => {
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: "n01se c0nfus3d", confidence: 25 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const blockWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: "ctfshow{block_saved}", confidence: 72 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce(blockWorker);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    // Primary returned 25 < 40 → block worker should be queried
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(blockWorker.recognize).toHaveBeenCalledTimes(1);
    // Block worker has higher confidence (72 > 25) → use its result
    expect(result).toEqual({ text: "ctfshow{block_saved}", confidence: 72 });
  });

  it("prefers an enhanced image that yields a complete hexadecimal Flag", async () => {
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockResolvedValueOnce({ data: { text: "ctfshow{noise}", confidence: 88 } })
        .mockResolvedValueOnce({ data: { text: "ctfshow{0123456789abcdef0123456789abcdef}", confidence: 61 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValue(worker);
    const prepareImages = vi.fn(async (image: Blob) => [image, new Blob([Uint8Array.of(1)], { type: "image/png" })]);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory, prepareImages);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ text: "ctfshow{0123456789abcdef0123456789abcdef}", confidence: 61 });
  });

  it("merges complementary hexadecimal OCR readings by support and symbol confidence", async () => {
    const expected = "ctfshow{dbf7d3f84b0125e833dfd3c80820a129}";
    const readings = [
      recognitionData("ctfshow{dbf7d3184b0125e833dfd3c80820a129}", { 14: 86, 30: 96 }),
      recognitionData("ctfshow{dbf7d3f84b0125e833dfd3080820a129}", { 14: 96, 30: 70 }),
      recognitionData("ctfshow{dbf7d3784b0125e833dfd3c80820a129}", { 14: 70, 30: 96 }),
    ];
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockResolvedValueOnce({ data: readings[0] })
        .mockResolvedValueOnce({ data: readings[1] })
        .mockResolvedValueOnce({ data: readings[2] }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValue(worker);
    const prepareImages = vi.fn(async (image: Blob) => [
      image,
      new Blob([Uint8Array.of(1)], { type: "image/png" }),
      new Blob([Uint8Array.of(2)], { type: "image/png" }),
    ]);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory, prepareImages);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(worker.recognize).toHaveBeenCalledTimes(3);
    expect(result.text).toBe(expected);
  });

  it("retries damaged hexadecimal-looking text in single-word mode", async () => {
    const damaged = "ctfshow(db7d3G4bDIRSe8330fd3cE0820a129)";
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: damaged, confidence: 72 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const lineWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockResolvedValueOnce({ data: { text: damaged, confidence: 72 } })
        .mockResolvedValueOnce({ data: { text: "ctfshow{0123456789abcdef0123456789abcdef}", confidence: 64 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const hexWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: "ctfshow{0123456789abcdef0123456789abcdef}", confidence: 64 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce(lineWorker).mockResolvedValueOnce(hexWorker);
    const prepareImages = vi.fn(async (image: Blob) => [image, new Blob([Uint8Array.of(1)], { type: "image/png" })]);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory, prepareImages);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(lineWorker.setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_pageseg_mode: PSM.SINGLE_WORD }));
    expect(lineWorker.recognize).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ text: "ctfshow{0123456789abcdef0123456789abcdef}", confidence: 64 });
  });

  it("uses a prefix-aware hexadecimal worker to build consensus for damaged text", async () => {
    const damaged = "ctfshow(db7d3G4bDIRSe8330fd3cE0820a129)";
    const expected = "ctfshow{dbf7d3f84b0125e833dfd3c80820a129}";
    const primaryWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: damaged, confidence: 72 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const blockWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: damaged, confidence: 72 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const hexWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockResolvedValueOnce({ data: recognitionData("ctfshow{dbf7d3184b0125e833dfd3c80820a129}", { 14: 86, 30: 96 }) })
        .mockResolvedValueOnce({ data: recognitionData("ctfshow{dbf7d3f84b0125e833dfd3080820a129}", { 14: 96, 30: 70 }) })
        .mockResolvedValueOnce({ data: recognitionData("ctfshow{dbf7d3784b0125e833dfd3c80820a129}", { 14: 70, 30: 96 }) }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn()
      .mockResolvedValueOnce(primaryWorker)
      .mockResolvedValueOnce(blockWorker)
      .mockResolvedValueOnce(hexWorker);
    const prepareImages = vi.fn(async (image: Blob) => [
      image,
      new Blob([Uint8Array.of(1)], { type: "image/png" }),
      new Blob([Uint8Array.of(2)], { type: "image/png" }),
    ]);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory, prepareImages);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(hexWorker.setParameters).toHaveBeenCalledWith(expect.objectContaining({
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
      tessedit_char_whitelist: expect.stringContaining("0123456789abcdef"),
    }));
    expect(hexWorker.recognize).toHaveBeenCalledTimes(3);
    expect(result.text).toBe(expected);
  });

  it("keeps non-complete text from every enhanced image for downstream repair", async () => {
    const primary = "ctfshow(db7d3G4bDIRSe8330fd3cE0820a129)";
    const alternate = "ctfshow{dbf7d3184b012Se833dfd3c80820a129";
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: primary, confidence: 70 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const lineWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn()
        .mockResolvedValueOnce({ data: { text: primary, confidence: 70 } })
        .mockResolvedValueOnce({ data: { text: alternate, confidence: 75 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const hexWorker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({ data: { text: alternate, confidence: 75 } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce(lineWorker).mockResolvedValueOnce(hexWorker);
    const prepareImages = vi.fn(async (image: Blob) => [image, new Blob([Uint8Array.of(1)], { type: "image/png" })]);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory, prepareImages);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(result.text).toContain(primary);
    expect(result.text).toContain(alternate);
  });

  it("returns OCR symbol geometry for duplicate-glyph recovery", async () => {
    const worker = {
      setParameters: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: "ctfshow{a1}",
          confidence: 91,
          blocks: [{
            paragraphs: [{
              lines: [{
                words: [{
                  symbols: [{ text: "a", confidence: 97, bbox: { x0: 10, y0: 2, x1: 18, y1: 20 } }],
                }],
              }],
            }],
          }],
        },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn().mockResolvedValue(worker);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(worker.recognize).toHaveBeenCalledWith(expect.any(Blob), {}, { text: true, blocks: true });
    expect(result.symbols).toEqual([
      { text: "a", confidence: 97, bbox: { x0: 10, y0: 2, x1: 18, y1: 20 } },
    ]);
  });
});
