import UPNG from "upng-js";
import { assessFlagCandidate, detectFlagLikeTokens, detectFlags } from "./flagDetector";
import type { LsbExtractedFile } from "./lsbTypes";
import type { StegoFinding, StegoPixelSource, StegoReport } from "./stegoTypes";

export interface StegoOcrCandidate {
  id: string;
  label: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface StegoOcrRecognition {
  text: string;
  confidence: number;
}

export interface StegoOcrResult extends StegoOcrRecognition {
  sourceId: string;
  sourceLabel: string;
  flags: string[];
  error?: string;
}

export interface StegoOcrAnalysisResult {
  results: StegoOcrResult[];
  findings: StegoFinding[];
}

export interface StegoOcrCollectionOptions {
  maximumCandidates?: number;
  maximumTotalBytes?: number;
  source?: StegoOcrCandidate;
}

export type StegoOcrRecognizer = (
  candidate: StegoOcrCandidate,
  signal: AbortSignal,
) => Promise<StegoOcrRecognition>;

function abortError() {
  const error = new Error("OCR 已取消");
  error.name = "AbortError";
  return error;
}

function mediaTypeForFormat(format: string) {
  if (format === "JPEG") return "image/jpeg";
  return `image/${format.toLowerCase()}`;
}

function encodeVisual(pixels: Uint8ClampedArray, width: number, height: number) {
  const copy = pixels.slice();
  return new Uint8Array(UPNG.encode([copy.buffer], width, height, 0));
}

export function normalizeStegoOcrSource(candidate: StegoOcrCandidate, pixels?: StegoPixelSource): StegoOcrCandidate {
  if (!pixels) return candidate;
  return {
    ...candidate,
    mediaType: "image/png",
    bytes: encodeVisual(new Uint8ClampedArray(pixels.rgba), pixels.width, pixels.height),
  };
}

function byteFingerprint(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}

function imageFiles(files: LsbExtractedFile[], path = ""): Array<{ file: LsbExtractedFile; path: string }> {
  return files.flatMap((file) => {
    const currentPath = path ? `${path}/${file.name}` : file.name;
    const current = file.mediaType.startsWith("image/") ? [{ file, path: currentPath }] : [];
    return [...current, ...imageFiles(file.children ?? [], currentPath)];
  });
}

export function collectStegoOcrCandidates(
  report: StegoReport,
  options: StegoOcrCollectionOptions = {},
): StegoOcrCandidate[] {
  const maximumCandidates = Math.max(1, Math.min(64, Math.floor(options.maximumCandidates ?? 16)));
  const maximumTotalBytes = Math.max(1024, Math.min(256 * 1024 * 1024, Math.floor(options.maximumTotalBytes ?? 64 * 1024 * 1024)));
  const candidates: StegoOcrCandidate[] = [];
  const fingerprints = new Set<string>();
  let totalBytes = 0;
  const add = (candidate: StegoOcrCandidate) => {
    if (candidates.length >= maximumCandidates || candidate.bytes.length === 0 || totalBytes + candidate.bytes.length > maximumTotalBytes) return;
    const fingerprint = byteFingerprint(candidate.bytes);
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    totalBytes += candidate.bytes.length;
    candidates.push(candidate);
  };

  if (options.source) add(options.source);
  for (const visual of report.visuals) {
    if (!/^(?:gif|apng)-frame-/.test(visual.id) && !visual.id.startsWith("animation-stitch-")) continue;
    add({
      id: `visual:${visual.id}`,
      label: visual.label,
      mediaType: "image/png",
      bytes: encodeVisual(visual.pixels, visual.width, visual.height),
    });
  }
  const addRepair = (repair: NonNullable<StegoReport["repairs"]>[number]) => {
    add({
      id: `repair:${repair.id}`,
      label: repair.label,
      mediaType: mediaTypeForFormat(repair.format),
      bytes: repair.bytes,
    });
  };
  for (const repair of (report.repairs ?? []).filter((candidate) => candidate.confidence === "exact")) addRepair(repair);
  for (const { file, path } of imageFiles(report.carvedFiles)) {
    add({ id: `carved:${path}`, label: path, mediaType: file.mediaType, bytes: file.bytes });
  }
  for (const repair of (report.repairs ?? []).filter((candidate) => candidate.confidence === "candidate").slice(0, 4)) addRepair(repair);
  return candidates;
}

function flagTextVariants(text: string) {
  const normalized = text
    .replace(/[｛]/g, "{")
    .replace(/[｝]/g, "}")
    .replace(/([A-Za-z][A-Za-z0-9_-]{1,31})\s*[\(\[]\s*([^{}]{3,512})\}/g, "$1{$2}")
    .replace(/([A-Za-z][A-Za-z0-9_-]{1,31}\s*\{\s*[^{}\r\n]{3,512})[\]\)](?=[ \t]*$)/gm, "$1}");
  const repaired = normalized.replace(/([A-Za-z][A-Za-z0-9_-]{1,31})\s*\{\s*([^{}]*?)\s*\}/g, (_match, prefix: string, payload: string) =>
    `${prefix}{${payload.replace(/\s+/g, "")}}`,
  );
  return [normalized, repaired];
}

export async function recognizeStegoCandidates(
  candidates: readonly StegoOcrCandidate[],
  prefixes: readonly string[],
  caseSensitive: boolean,
  recognize: StegoOcrRecognizer,
  signal: AbortSignal,
): Promise<StegoOcrAnalysisResult> {
  if (signal.aborted) throw abortError();
  const results: StegoOcrResult[] = [];
  const findings: StegoFinding[] = [];
  const seenFlags = new Set<string>();
  for (const candidate of candidates) {
    if (signal.aborted) throw abortError();
    try {
      const recognition = await recognize(candidate, signal);
      if (signal.aborted) throw abortError();
      const variants = flagTextVariants(recognition.text);
      const configuredFlags = variants.flatMap((text) => detectFlags(text, prefixes, caseSensitive).map((hit) => hit.text));
      const keyForFlag = (flag: string) => (caseSensitive ? flag : flag.toLowerCase()).replace(/\s+/g, "");
      const configuredKeys = new Set(configuredFlags.map(keyForFlag));
      const flagKeys = new Set<string>();
      const flags = [...configuredFlags, ...variants.flatMap(detectFlagLikeTokens)]
        .sort((left, right) => (left.match(/\s/g)?.length ?? 0) - (right.match(/\s/g)?.length ?? 0))
        .filter((flag) => {
          const key = keyForFlag(flag);
          if (flagKeys.has(key)) return false;
          flagKeys.add(key);
          return true;
        });
      results.push({
        sourceId: candidate.id,
        sourceLabel: candidate.label,
        text: recognition.text,
        confidence: recognition.confidence,
        flags,
      });
      for (const flag of flags) {
        const key = caseSensitive ? flag : flag.toLowerCase();
        if (seenFlags.has(key)) continue;
        seenFlags.add(key);
        const assessment = assessFlagCandidate(flag);
        const configured = configuredKeys.has(keyForFlag(flag));
        findings.push({
          id: `ocr-flag-${findings.length}`,
          severity: configured && assessment.confidence === "high" ? "high" : "suspicious",
          source: `OCR · ${candidate.label}`,
          title: configured && assessment.confidence === "high" ? "OCR 发现 Flag" : "OCR 疑似 Flag",
          detail: flag,
        });
      }
    } catch (error) {
      if (signal.aborted || error instanceof Error && error.name === "AbortError") throw abortError();
      results.push({
        sourceId: candidate.id,
        sourceLabel: candidate.label,
        text: "",
        confidence: 0,
        flags: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { results, findings };
}
