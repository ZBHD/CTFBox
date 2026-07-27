import { describe, expect, it, vi } from "vitest";
import { OEM, PSM } from "tesseract.js";
import type { StegoOcrCandidate } from "./stegoOcr";
import { OfflineStegoOcrEngine, offlineOcrAssetUrls } from "./stegoOcrEngine";

const candidate: StegoOcrCandidate = {
  id: "visual:frame",
  label: "frame",
  mediaType: "image/png",
  bytes: Uint8Array.of(137, 80, 78, 71),
};

describe("offline OCR engine", () => {
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
