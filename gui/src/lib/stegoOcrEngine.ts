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

type OcrImagePreparer = (image: Blob) => Promise<Blob[]>;

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

function recognitionScore(data: OcrRecognitionData) {
  const text = data.text ?? "";
  let score = data.confidence;
  if (/[A-Za-z][A-Za-z0-9_-]{1,31}\{[0-9a-fA-F]{32}\}/.test(text)) score += 10_000;
  else if (/[A-Za-z][A-Za-z0-9_-]{1,31}\s*[({[]\s*[A-Za-z0-9_+./=-]{24,40}/.test(text)) score += 2_000;
  else if (/[A-Za-z][A-Za-z0-9_-]{1,31}\s*[({[]/.test(text)) score += 500;
  return score;
}

interface HexFlagReading {
  prefix: string;
  payload: string;
  confidence: number;
  characterConfidence: number[];
}

function ocrSymbols(data: OcrRecognitionData) {
  return (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)
    .flatMap((word) => word.symbols);
}

function symbolConfidenceByTextOffset(data: OcrRecognitionData) {
  const confidence = new Map<number, number>();
  let cursor = 0;
  for (const symbol of ocrSymbols(data)) {
    const offset = data.text.indexOf(symbol.text, cursor);
    if (offset < 0) continue;
    for (let index = 0; index < symbol.text.length; index += 1) confidence.set(offset + index, symbol.confidence);
    cursor = offset + symbol.text.length;
  }
  return confidence;
}

function hexFlagReadings(data: OcrRecognitionData) {
  const readings: HexFlagReading[] = [];
  const confidence = symbolConfidenceByTextOffset(data);
  const patterns = [
    /([A-Za-z][A-Za-z0-9_-]{1,31})\s*\{\s*([0-9a-fA-F]{32,33})/g,
    /^\s*([A-Za-z][A-Za-z0-9_-]{1,31}?)([0-9a-fA-F]{32,33})[}\])]?\s*$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of data.text.matchAll(pattern)) {
      const rawPayload = match[2];
      const payload = rawPayload.slice(0, 32).toLowerCase();
      const matchStart = match.index ?? 0;
      const payloadStart = matchStart + match[0].lastIndexOf(rawPayload);
      readings.push({
        prefix: match[1],
        payload,
        confidence: data.confidence,
        characterConfidence: Array.from({ length: 32 }, (_, index) => confidence.get(payloadStart + index) ?? data.confidence),
      });
    }
  }
  return readings;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex].toLowerCase() === right[rightIndex].toLowerCase() ? 0 : 1),
      ));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function hammingDistance(left: string, right: string) {
  let distance = Math.abs(left.length - right.length);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

function consensusHexFlag(data: readonly OcrRecognitionData[]) {
  const readings = data.flatMap(hexFlagReadings);
  const clusters: HexFlagReading[][] = [];
  for (const reading of readings) {
    const cluster = clusters.find((items) =>
      editDistance(items[0].prefix, reading.prefix) <= 2
      && items.some((item) => hammingDistance(item.payload, reading.payload) <= 8),
    );
    if (cluster) cluster.push(reading);
    else clusters.push([reading]);
  }
  const cluster = clusters
    .map((items) => [...new Map(items
      .sort((left, right) => right.confidence - left.confidence)
      .map((item) => [item.payload, item])).values()])
    .filter((items) => items.length >= 3)
    .sort((left, right) => right.length - left.length)[0];
  if (!cluster) return undefined;

  const prefix = cluster.reduce((preferred, candidate) => {
    const preferredDistance = cluster.reduce((total, item) => total + editDistance(preferred.prefix, item.prefix), 0);
    const candidateDistance = cluster.reduce((total, item) => total + editDistance(candidate.prefix, item.prefix), 0);
    return candidateDistance < preferredDistance ? candidate : preferred;
  }).prefix.toLowerCase();
  let payload = "";
  for (let index = 0; index < 32; index += 1) {
    const alternatives = new Map<string, { support: number; maximumConfidence: number }>();
    for (const reading of cluster) {
      const character = reading.payload[index];
      const current = alternatives.get(character) ?? { support: 0, maximumConfidence: 0 };
      current.support += 1;
      current.maximumConfidence = Math.max(current.maximumConfidence, reading.characterConfidence[index] ?? reading.confidence);
      alternatives.set(character, current);
    }
    const preferred = [...alternatives.entries()].sort((left, right) => {
      const leftScore = left[1].maximumConfidence + Math.log2(left[1].support + 1) * 4;
      const rightScore = right[1].maximumConfidence + Math.log2(right[1].support + 1) * 4;
      return rightScore - leftScore || right[1].support - left[1].support || left[0].localeCompare(right[0]);
    })[0];
    payload += preferred[0];
  }
  return {
    text: `${prefix}{${payload}}`,
    confidence: Math.max(...cluster.map((reading) => reading.confidence)),
  };
}

function looksLikeDamagedHexFlag(text: string) {
  const match = text.match(/[A-Za-z][A-Za-z0-9_-]{1,31}\s*[({[]\s*([A-Za-z0-9\s]{24,48})/);
  if (!match) return false;
  const payload = match[1].replace(/\s+/g, "");
  if (payload.length < 28 || payload.length > 36) return false;
  const hexCharacters = payload.match(/[0-9a-f]/gi)?.length ?? 0;
  return hexCharacters / payload.length >= 0.6;
}

function hexadecimalWhitelist(text: string) {
  const prefix = text.match(/([A-Za-z][A-Za-z0-9_-]{1,31})\s*[({[]/)?.[1]
    .toLowerCase()
    .replace(/[^a-z]/g, "") ?? "flagctf";
  return [...new Set(`0123456789abcdef{}${prefix}`)].join("");
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("OCR 预处理图片编码失败"));
  }, "image/png"));
}

export function findOcrTextBands(mask: Uint8Array, width: number, height: number) {
  if (width < 1 || height < 1 || mask.length < width * height) return [];
  const minimumForeground = Math.max(1, Math.floor(width * 0.005));
  const active = Array.from({ length: height }, (_, row) => {
    let count = 0;
    for (let column = 0; column < width; column += 1) count += mask[row * width + column] ? 1 : 0;
    return count >= minimumForeground;
  });
  const bands: Array<{ start: number; end: number }> = [];
  for (let row = 0; row < height;) {
    if (!active[row]) {
      row += 1;
      continue;
    }
    const start = row;
    while (row < height && active[row]) row += 1;
    if (row - start >= 2) bands.push({ start, end: row });
  }
  return bands;
}

export function shouldCropOcrTextBands(
  bands: readonly { start: number; end: number }[],
  imageHeight: number,
) {
  return bands.length > 1 || bands.some((band) => band.end - band.start < imageHeight * 0.5);
}

export function expandOcrTextBand(
  band: { start: number; end: number },
  imageHeight: number,
) {
  const textHeight = Math.max(1, band.end - band.start);
  return {
    start: Math.max(0, band.start - textHeight),
    end: Math.min(imageHeight, band.end + textHeight),
  };
}

export function normalizeOcrBandPixels(pixels: Uint8ClampedArray) {
  const output = new Uint8ClampedArray(pixels.length);
  let minimum = 255;
  let maximum = 0;
  const luminances = new Uint8Array(Math.floor(pixels.length / 4));
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const luminance = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    luminances[offset / 4] = luminance;
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
  }
  const background = luminances[0] ?? maximum;
  const range = Math.max(1, maximum - minimum);
  for (let index = 0; index < luminances.length; index += 1) {
    const normalized = Math.round((luminances[index] - minimum) * 255 / range);
    const value = background < 128 ? 255 - normalized : normalized;
    const offset = index * 4;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
    output[offset + 3] = 255;
  }
  return output;
}

export async function prepareStegoOcrImages(image: Blob): Promise<Blob[]> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return [image];
  const bitmap = await createImageBitmap(image);
  try {
    const pixels = bitmap.width * bitmap.height;
    if (bitmap.width < 1 || bitmap.height < 1 || pixels > 16_000_000) return [image];
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return [image];
    sourceContext.drawImage(bitmap, 0, 0);
    const source = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
    const histogram = new Uint32Array(256);
    let minimum = 255;
    let maximum = 0;
    for (let offset = 0; offset < source.data.length; offset += 4) {
      const luminance = Math.round(source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114);
      histogram[luminance] += 1;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
    }
    let background = 0;
    for (let value = 1; value < histogram.length; value += 1) {
      if (histogram[value] > histogram[background]) background = value;
    }
    const range = Math.max(1, maximum - minimum);
    const threshold = Math.max(6, Math.round(range * 0.04));
    const scale = Math.max(1, Math.min(16, 4096 / Math.max(bitmap.width, bitmap.height), 240 / bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const variants: Blob[] = [image];
    const foregroundMask = new Uint8Array(pixels);
    let binaryCanvas: HTMLCanvasElement | undefined;
    for (const binary of [false, true]) {
      const transformed = new ImageData(new Uint8ClampedArray(source.data), bitmap.width, bitmap.height);
      for (let offset = 0; offset < transformed.data.length; offset += 4) {
        const luminance = Math.round(transformed.data[offset] * 0.299 + transformed.data[offset + 1] * 0.587 + transformed.data[offset + 2] * 0.114);
        const normalized = Math.round((luminance - minimum) * 255 / range);
        const value = binary
          ? (Math.abs(luminance - background) >= threshold ? 0 : 255)
          : (background < 128 ? 255 - normalized : normalized);
        if (binary) foregroundMask[offset / 4] = value === 0 ? 1 : 0;
        transformed.data[offset] = value;
        transformed.data[offset + 1] = value;
        transformed.data[offset + 2] = value;
        transformed.data[offset + 3] = 255;
      }
      const transformedCanvas = document.createElement("canvas");
      transformedCanvas.width = bitmap.width;
      transformedCanvas.height = bitmap.height;
      transformedCanvas.getContext("2d")?.putImageData(transformed, 0, 0);
      if (binary) binaryCanvas = transformedCanvas;
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = width;
      outputCanvas.height = height;
      const outputContext = outputCanvas.getContext("2d");
      if (!outputContext) continue;
      outputContext.imageSmoothingEnabled = !binary;
      outputContext.drawImage(transformedCanvas, 0, 0, width, height);
      variants.push(await canvasBlob(outputCanvas));
    }
    const bands = findOcrTextBands(foregroundMask, bitmap.width, bitmap.height);
    if (binaryCanvas && shouldCropOcrTextBands(bands, bitmap.height)) {
      for (const band of bands.slice(0, 6)) {
        const expanded = expandOcrTextBand(band, bitmap.height);
        const start = expanded.start;
        const bandHeight = expanded.end - expanded.start;
        const bandScale = Math.max(1, Math.min(16, 4096 / bitmap.width, 240 / bandHeight));
        const softScale = Math.max(1, Math.min(8, 4096 / bitmap.width, 240 / bandHeight));
        const localPixels = sourceContext.getImageData(0, start, bitmap.width, bandHeight);
        const normalizedCanvas = document.createElement("canvas");
        normalizedCanvas.width = bitmap.width;
        normalizedCanvas.height = bandHeight;
        normalizedCanvas.getContext("2d")?.putImageData(new ImageData(
          normalizeOcrBandPixels(localPixels.data),
          bitmap.width,
          bandHeight,
        ), 0, 0);
        for (const crop of [
          { canvas: sourceCanvas, sourceY: start, smoothing: true },
          { canvas: normalizedCanvas, sourceY: 0, smoothing: true },
          { canvas: binaryCanvas, sourceY: start, smoothing: false },
        ]) {
          const scales = crop.smoothing && bandScale - softScale > 0.5
            ? [bandScale, softScale]
            : [bandScale];
          for (const scale of scales) {
            const outputCanvas = document.createElement("canvas");
            outputCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
            outputCanvas.height = Math.max(1, Math.round(bandHeight * scale));
            const outputContext = outputCanvas.getContext("2d");
            if (!outputContext) continue;
            outputContext.imageSmoothingEnabled = crop.smoothing;
            if (crop.smoothing) outputContext.imageSmoothingQuality = "high";
            outputContext.drawImage(
              crop.canvas,
              0,
              crop.sourceY,
              bitmap.width,
              bandHeight,
              0,
              0,
              outputCanvas.width,
              outputCanvas.height,
            );
            variants.push(await canvasBlob(outputCanvas));
          }
        }
      }
    }
    return variants;
  } finally {
    bitmap.close();
  }
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
  private hexWorkerPromise?: Promise<OcrWorkerLike>;

  constructor(
    private readonly baseUrl = document.baseURI,
    private readonly factory: OcrWorkerFactory = createWorker as unknown as OcrWorkerFactory,
    private readonly prepareImages: OcrImagePreparer = prepareStegoOcrImages,
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
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}_-!@#$%^&*()[]<>/?.,:;\"' ",
      });
      return worker;
    });
    return this.blockWorkerPromise;
  }

  private hexWorker() {
    this.hexWorkerPromise ??= this.factory("eng", OEM.LSTM_ONLY, {
      ...offlineOcrAssetUrls(this.baseUrl),
      workerBlobURL: false,
      gzip: true,
      legacyCore: false,
      legacyLang: false,
    });
    return this.hexWorkerPromise;
  }

  async recognize(candidate: StegoOcrCandidate, signal: AbortSignal): Promise<StegoOcrRecognition> {
    if (signal.aborted) throw abortError();
    const worker = await this.worker();
    if (signal.aborted) throw abortError();
    const onAbort = () => void this.dispose();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const image = new Blob([candidate.bytes.slice().buffer as ArrayBuffer], { type: candidate.mediaType });
      const images = await this.prepareImages(image);
      const recognized: Array<{ image: Blob; data: OcrRecognitionData }> = [];
      for (const prepared of images) {
        if (signal.aborted) throw abortError();
        const result = await worker.recognize(prepared, {}, { text: true, blocks: true });
        recognized.push({ image: prepared, data: result.data });
      }
      let best = recognized.reduce((preferred, current) =>
        recognitionScore(current.data) > recognitionScore(preferred.data) ? current : preferred,
      );
      let fallbackImproved = false;
      if (signal.aborted) throw abortError();

      // If low confidence or empty text, retry with SINGLE_BLOCK + whitelist
      const completeHex = /[A-Za-z][A-Za-z0-9_-]{1,31}\{[0-9a-fA-F]{32}\}/.test(best.data.text ?? "");
      const damagedHex = !completeHex && looksLikeDamagedHexFlag(best.data.text ?? "");
      if (best.data.confidence < 40 || (best.data.text ?? "").trim().length === 0 || damagedHex) {
        const blockWorker = await this.blockWorker();
        const retryImages = damagedHex ? images : [best.image];
        for (const retryImage of retryImages) {
          if (signal.aborted) throw abortError();
          const blockResult = await blockWorker.recognize(retryImage, {}, { text: true, blocks: true });
          const blockEntry = { image: retryImage, data: blockResult.data };
          recognized.push(blockEntry);
          if (recognitionScore(blockResult.data) > recognitionScore(best.data)) {
            best = blockEntry;
            fallbackImproved = true;
          }
        }
      }

      if (damagedHex) {
        const hexWorker = await this.hexWorker();
        await hexWorker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_WORD,
          preserve_interword_spaces: "0",
          tessedit_char_whitelist: hexadecimalWhitelist(best.data.text ?? ""),
        });
        for (const retryImage of images) {
          if (signal.aborted) throw abortError();
          const hexResult = await hexWorker.recognize(retryImage, {}, { text: true, blocks: true });
          const hexEntry = { image: retryImage, data: hexResult.data };
          recognized.push(hexEntry);
          if (recognitionScore(hexResult.data) > recognitionScore(best.data)) best = hexEntry;
        }
      }

      const consensus = consensusHexFlag(recognized.map((item) => item.data));
      const recognition = consensus ?? recognitionFrom(best.data);
      if ((!fallbackImproved || images.length > 1)
        && !/[A-Za-z][A-Za-z0-9_-]{1,31}\{[0-9a-fA-F]{32}\}/.test(best.data.text ?? "")) {
        recognition.text = [...new Set(recognized.map((item) => item.data.text?.trim()).filter(Boolean))].join("\n");
      }
      return recognition;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async dispose() {
    const workerPromises = [this.workerPromise, this.blockWorkerPromise, this.hexWorkerPromise].filter(
      (promise): promise is Promise<OcrWorkerLike> => promise !== undefined,
    );
    this.workerPromise = undefined;
    this.blockWorkerPromise = undefined;
    this.hexWorkerPromise = undefined;
    for (const workerPromise of workerPromises) {
      try {
        const worker = await workerPromise;
        await worker.terminate();
      } catch {
        // A failed or cancelled worker is already unusable.
      }
    }
  }
}
