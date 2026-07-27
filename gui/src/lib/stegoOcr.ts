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

// OCR character confusion substitution map — applied only inside flag payloads,
// NOT to the flag prefix, to avoid breaking configured prefix matches.
// Only safe substitutions: characters that are virtually never valid in text
// but commonly confused with their numeric/alphabetic counterpart in OCR.
const OCR_PAYLOAD_FIXES: Array<[RegExp, string]> = [
  [/[OＯ]/g, "0"],     // letter O → digit 0 (most common CTF hex confusion)
  [/[l|ⅠＩ]/g, "1"],   // lowercase L or unicode I → digit 1
  [/[¢ç]/g, "c"],     // cent sign → letter c
];

/** Apply payload-only character fixes: replace chars only inside {} braces. */
function applyOcrPayloadFixes(text: string): string {
  return text.replace(/(\{[^{}]*\})/g, (match) => {
    let fixed = match;
    for (const [pattern, replacement] of OCR_PAYLOAD_FIXES) {
      fixed = fixed.replace(pattern, replacement);
    }
    return fixed;
  });
}

// Also apply full-text fixes for non-flag text interpretation
const OCR_FULL_FIXES: Array<[RegExp, string]> = [
  [/[：]/g, ":"],
  [/[；]/g, ";"],
];

function applyOcrFixes(text: string): string {
  let result = text;
  for (const [pattern, replacement] of OCR_FULL_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function flagTextVariants(text: string) {
  const fixed = applyOcrFixes(text);
  const withPayloadFixes = applyOcrPayloadFixes(fixed);
  const normalized = withPayloadFixes
    .replace(/[｛]/g, "{")
    .replace(/[｝]/g, "}")
    .replace(/([A-Za-z][A-Za-z0-9_-]{1,31})\s*[\(\[]\s*([^{}]{3,512})\}/g, "$1{$2}")
    .replace(/([A-Za-z][A-Za-z0-9_-]{1,31}\s*\{\s*[^{}\r\n]{3,512})[\]\)](?=[ \t]*$)/gm, "$1}");
  const repaired = normalized.replace(/([A-Za-z][A-Za-z0-9_-]{1,31})\s*\{\s*([^{}]*?)\s*\}/g, (_match, prefix: string, payload: string) =>
    `${prefix}{${payload.replace(/\s+/g, "")}}`,
  );
  // Third variant: try full-text char fixes for cases where O→0 in the prefix too
  // (helps with detectFlagLikeTokens which doesn't require a specific prefix)
  const fullFixed = applyOcrPayloadFixes(fixed); // only payload fixes, don't break prefix
  const fullNormalized = fullFixed
    .replace(/[｛]/g, "{").replace(/[｝]/g, "}")
    .replace(/([A-Za-z][A-Za-z0-9_-]{1,31})\s*[\(\[]\s*([^{}]{3,512})\}/g, "$1{$2}")
    .replace(/([A-Za-z][A-Za-z0-9_-]{1,31}\s*\{\s*[^{}\r\n]{3,512})[\]\)](?=[ \t]*$)/gm, "$1}");
  return fullNormalized === normalized ? [normalized, repaired] : [normalized, repaired, fullNormalized];
}

/** Normalize a flag string for dedup comparison (lowercase, no spaces). */
function normalizeFlagKey(flag: string): string {
  return flag.toLowerCase().replace(/\s+/g, "");
}

/** Score a flag candidate by evidence quality. Higher = more trustworthy. */
export function scoreFlagCandidate(
  flag: string,
  source: string,
  confidencePercent: number,
  hasDirectBytes: boolean,
  crossSourceCount: number,
): number {
  let score = 0;
  // 32-char hex payload = complete MD5-style flag
  if (/\{[0-9a-fA-F]{32}\}/.test(flag)) score += 300;
  else if (/\{[0-9a-fA-F]{16,31}\}/.test(flag)) score += 150;
  else if (/\{[A-Za-z0-9_-]{4,}\}/.test(flag)) score += 50;
  // Direct byte evidence (not OCR)
  if (hasDirectBytes) score += 200;
  // OCR confidence bonus
  score += Math.min(100, confidencePercent);
  // Metadata/structural source bonus
  if (/^(元数据|PNG 文本|EXIF|GIF|结构|ASCII)/.test(source)) score += 50;
  // Cross-source confirmation
  if (crossSourceCount >= 2) score += 80;
  // Short payload penalty
  const payload = flag.match(/\{([^}]*)\}/)?.[1] ?? "";
  if (payload.length < 8) score -= 100;
  else if (payload.length >= 32) score += 50;
  return score;
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
  // Collect all flag finds across candidates, keyed by normalized flag
  const findingsByKey = new Map<string, {
    flag: string; source: string; assessment: { confidence: string }; configured: boolean; candidateLabel: string;
  }[]>();
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
        const key = keyForFlag(flag);
        const assessment = assessFlagCandidate(flag);
        const configured = configuredKeys.has(keyForFlag(flag));
        const existing = findingsByKey.get(key) ?? [];
        existing.push({ flag, source: `OCR · ${candidate.label}`, assessment, configured, candidateLabel: candidate.label });
        findingsByKey.set(key, existing);
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
  // Score-based dedup across all candidates
  const seenNormalized = new Set<string>();
  const deduped = [...findingsByKey.entries()]
    .map(([key, entries]) => {
      const best = entries.reduce((a, b) => {
        // Prefer complete flags (32-char hex) over short/partial
        const aScore = scoreFlagCandidate(b.flag, b.source, 0, false, entries.length);
        const bScore = scoreFlagCandidate(a.flag, a.source, 0, false, entries.length);
        return aScore > bScore ? a : b;
      });
      return { key, best, crossSourceCount: new Set(entries.map((e) => e.source.replace(/OCR · /, ""))).size };
    })
    .sort((a, b) => {
      const aScore = scoreFlagCandidate(b.best.flag, b.best.source, 0, false, b.crossSourceCount);
      const bScore = scoreFlagCandidate(a.best.flag, a.best.source, 0, false, a.crossSourceCount);
      return aScore - bScore; // higher score first
    });
  for (const { key, best, crossSourceCount } of deduped) {
    if (seenNormalized.has(key)) continue;
    seenNormalized.add(key);
    findings.push({
      id: `ocr-flag-${findings.length}`,
      severity: best.configured && best.assessment.confidence === "high" ? "high" : "suspicious",
      source: best.source,
      title: best.configured && best.assessment.confidence === "high" ? "OCR 发现 Flag" : "OCR 疑似 Flag",
      detail: best.flag,
    });
  }
  return { results, findings };
}
