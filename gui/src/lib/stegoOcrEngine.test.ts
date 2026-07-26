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
    const factory = vi.fn().mockResolvedValue(worker);
    const engine = new OfflineStegoOcrEngine("http://localhost:1420/index.html", factory);

    const result = await engine.recognize(candidate, new AbortController().signal);
    await engine.dispose();

    expect(factory).toHaveBeenCalledWith("eng", OEM.LSTM_ONLY, expect.objectContaining({
      workerPath: "http://localhost:1420/ocr/worker.min.js",
      corePath: "http://localhost:1420/ocr/core",
      langPath: "http://localhost:1420/ocr/lang",
      workerBlobURL: false,
      gzip: true,
    }));
    expect(worker.setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }));
    expect(worker.recognize).toHaveBeenCalledWith(expect.any(Blob));
    expect(result).toEqual({ text: "ctfshow{ocr_engine}", confidence: 91 });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
