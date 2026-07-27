import { createWorker, OEM, PSM } from "tesseract.js";
import type { StegoOcrCandidate, StegoOcrRecognition } from "./stegoOcr";

interface OcrSymbolLike {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface OcrRecognitionData {
  text: string;
  confidence: number;
  blocks?: Array<{
    paragraphs: Array<{
      lines: Array<{
        words: Array<{ symbols: OcrSymbolLike[] }>;
      }>;
    }>;
  }> | null;
}

interface OcrWorkerLike {
  setParameters(parameters: Record<string, unknown>): Promise<unknown>;
  recognize(
    image: Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: OcrRecognitionData }>;
  terminate(): Promise<unknown>;
}

type OcrWorkerFactory = (
  language: string,
  oem: number,
  options: Record<string, unknown>,
) => Promise<OcrWorkerLike>;

function abortError() {
  const error = new Error("OCR 已取消");
  error.name = "AbortError";
  return error;
}

function recognitionFrom(data: OcrRecognitionData): StegoOcrRecognition {
  const symbols = (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)
    .flatMap((word) => word.symbols)
    .map((symbol) => ({ text: symbol.text, confidence: symbol.confidence, bbox: { ...symbol.bbox } }));
  return symbols.length > 0
    ? { text: data.text, confidence: data.confidence, symbols }
    : { text: data.text, confidence: data.confidence };
}

export function offlineOcrAssetUrls(baseUrl: string) {
  return {
    workerPath: new URL("ocr/worker.min.js", baseUrl).href,
    corePath: new URL("ocr/core", baseUrl).href,
    langPath: new URL("ocr/lang", baseUrl).href,
  };
}

export class OfflineStegoOcrEngine {
  private workerPromise?: Promise<OcrWorkerLike>;
  private blockWorkerPromise?: Promise<OcrWorkerLike>;

  constructor(
    private readonly baseUrl = document.baseURI,
    private readonly factory: OcrWorkerFactory = createWorker as unknown as OcrWorkerFactory,
  ) {}

  private worker() {
    this.workerPromise ??= this.factory("eng", OEM.LSTM_ONLY, {
      ...offlineOcrAssetUrls(this.baseUrl),
      workerBlobURL: false,
      gzip: true,
      legacyCore: false,
      legacyLang: false,
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      return worker;
    });
    return this.workerPromise;
  }

  private blockWorker() {
    this.blockWorkerPromise ??= this.factory("eng", OEM.LSTM_ONLY, {
      ...offlineOcrAssetUrls(this.baseUrl),
      workerBlobURL: false,
      gzip: true,
      legacyCore: false,
      legacyLang: false,
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}_-!@#$%^&*()[]<>/?.,:;\"' ",
      });
      return worker;
    });
    return this.blockWorkerPromise;
  }

  async recognize(candidate: StegoOcrCandidate, signal: AbortSignal): Promise<StegoOcrRecognition> {
    if (signal.aborted) throw abortError();
    const worker = await this.worker();
    if (signal.aborted) throw abortError();
    const onAbort = () => void this.dispose();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const image = new Blob([candidate.bytes.slice().buffer as ArrayBuffer], { type: candidate.mediaType });
      const result = await worker.recognize(image, {}, { text: true, blocks: true });
      if (signal.aborted) throw abortError();

      // If low confidence or empty text, retry with SINGLE_BLOCK + whitelist
      if (result.data.confidence < 40 || (result.data.text ?? "").trim().length === 0) {
        const blockWorker = await this.blockWorker();
        const blockResult = await blockWorker.recognize(image, {}, { text: true, blocks: true });
        if (blockResult.data.confidence > result.data.confidence) {
          return recognitionFrom(blockResult.data);
        }
      }

      return recognitionFrom(result.data);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async dispose() {
    const workerPromise = this.workerPromise;
    this.workerPromise = undefined;
    if (!workerPromise) return;
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch {
      // A failed or cancelled worker is already unusable.
    }
    const blockWorkerPromise = this.blockWorkerPromise;
    this.blockWorkerPromise = undefined;
    if (!blockWorkerPromise) return;
    try {
      const worker = await blockWorkerPromise;
      await worker.terminate();
    } catch {
      // A failed or cancelled worker is already unusable.
    }
  }
}
