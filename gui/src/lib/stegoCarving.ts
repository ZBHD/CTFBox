import { Buffer } from "buffer";
import { unzlibSync } from "fflate";
import { assessFlagCandidate, detectFlags } from "./flagDetector";
import { unpackArchive } from "./lsbArchive";
import { findEmbeddedFiles } from "./lsbFormats";
import type { LsbExtractedFile } from "./lsbTypes";
import type { StegoFinding } from "./stegoTypes";

export interface EmbeddedScanOptions {
  prefixes: readonly string[];
  caseSensitive?: boolean;
  maxDepth?: number;
  maxCandidates?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxCompressionRatio?: number;
}

export interface EmbeddedScanResult {
  files: LsbExtractedFile[];
  findings: StegoFinding[];
}

interface ScanLimits {
  prefixes: readonly string[];
  caseSensitive: boolean;
  maxDepth: number;
  maxCandidates: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
}

interface ScanBudget {
  candidates: number;
  totalBytes: number;
}

const DEFAULT_LIMITS: ScanLimits = {
  prefixes: [],
  caseSensitive: false,
  maxDepth: 3,
  maxCandidates: 256,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 500,
};

function normalizedLimits(options: EmbeddedScanOptions): ScanLimits {
  return {
    prefixes: options.prefixes,
    caseSensitive: options.caseSensitive ?? false,
    maxDepth: Math.max(0, Math.min(8, Math.floor(options.maxDepth ?? DEFAULT_LIMITS.maxDepth))),
    maxCandidates: Math.max(1, Math.min(4096, Math.floor(options.maxCandidates ?? DEFAULT_LIMITS.maxCandidates))),
    maxFileBytes: Math.max(64, Math.min(512 * 1024 * 1024, Math.floor(options.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes))),
    maxTotalBytes: Math.max(64, Math.min(1024 * 1024 * 1024, Math.floor(options.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes))),
    maxCompressionRatio: Math.max(1, Math.min(10_000, options.maxCompressionRatio ?? DEFAULT_LIMITS.maxCompressionRatio)),
  };
}

function warning(name: string, message: string, offset = 0): LsbExtractedFile {
  return { name, mediaType: "text/plain", offset, bytes: new Uint8Array(), text: message, warning: message };
}

function readableText(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text) return "";
    const printable = Array.from(text).filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length;
    return printable / Array.from(text).length >= 0.85 ? text : undefined;
  } catch {
    return undefined;
  }
}

function evidenceText(bytes: Uint8Array) {
  const whole = readableText(bytes);
  if (whole !== undefined) return whole;
  const runs: string[] = [];
  let start = -1;
  for (let offset = 0; offset <= bytes.length; offset += 1) {
    const byte = bytes[offset];
    const printable = byte === 9 || byte === 10 || byte === 13 || byte >= 32 && byte <= 126;
    if (printable && start < 0) start = offset;
    if (!printable && start >= 0) {
      if (offset - start >= 4) runs.push(String.fromCharCode(...bytes.subarray(start, Math.min(offset, start + 4096))));
      start = -1;
    }
  }
  return runs.length > 0 ? runs.slice(0, 256).join("\n") : undefined;
}

function embeddedName(offset: number, extension: string) {
  return `embedded-${offset}.${extension}`;
}

function extension(mediaType: string) {
  const values: Record<string, string> = {
    "application/zlib": "zlib",
    "application/x-bzip2": "bz2",
    "application/x-lzma": "lzma",
  };
  return values[mediaType] ?? "bin";
}

function outputLimit(inputLength: number, limits: ScanLimits, budget: ScanBudget) {
  return Math.max(0, Math.min(
    limits.maxFileBytes,
    limits.maxTotalBytes - budget.totalBytes,
    Math.floor(Math.max(1, inputLength) * limits.maxCompressionRatio),
  ));
}

function reserveOutput(bytes: Uint8Array, limits: ScanLimits, budget: ScanBudget) {
  if (bytes.length > limits.maxFileBytes || budget.totalBytes + bytes.length > limits.maxTotalBytes) return false;
  budget.totalBytes += bytes.length;
  return true;
}

async function decodeBzip2(bytes: Uint8Array, maximum: number) {
  if (maximum < 1) throw new Error("解压输出超过限制");
  (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ??= Buffer;
  const imported = await import("seek-bzip");
  const Bunzip = imported.default;
  const output = new Uint8Array(maximum);
  let position = 0;
  Bunzip.decode(Buffer.from(bytes), {
    writeByte(byte: number) {
      if (position >= output.length) throw new Error(`解压输出超过限制 ${maximum} 字节`);
      output[position++] = byte;
    },
  });
  return output.slice(0, position);
}

async function decodeLzma(bytes: Uint8Array, maximum: number) {
  if (maximum < 1) throw new Error("解压输出超过限制");
  const imported = await import("lzma/src/lzma-d.js");
  const decoded = imported.default.LZMA.decompress(bytes);
  const output = typeof decoded === "string"
    ? new TextEncoder().encode(decoded)
    : Uint8Array.from(decoded, (byte) => byte & 0xff);
  if (output.length > maximum) throw new Error(`解压输出超过限制 ${maximum} 字节`);
  return output;
}

function isZlibHeader(bytes: Uint8Array, offset: number) {
  if (offset + 2 > bytes.length) return false;
  const cmf = bytes[offset];
  const flg = bytes[offset + 1];
  return (cmf & 15) === 8 && (cmf >>> 4) <= 7 && ((cmf << 8) | flg) % 31 === 0 && (flg & 0x20) === 0;
}

function readU32Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function isLzmaHeader(bytes: Uint8Array, offset: number, limits: ScanLimits) {
  if (offset + 13 > bytes.length || bytes[offset] > 224) return false;
  const dictionary = readU32Le(bytes, offset + 1);
  if (dictionary < 4096 || dictionary > 512 * 1024 * 1024 || (dictionary & (dictionary - 1)) !== 0) return false;
  const sizeBytes = bytes.subarray(offset + 5, offset + 13);
  if (sizeBytes.every((byte) => byte === 0xff)) return true;
  const low = readU32Le(bytes, offset + 5);
  const high = readU32Le(bytes, offset + 9);
  return high === 0 && low <= limits.maxFileBytes;
}

function derivedFile(mediaType: string, offset: number, compressed: Uint8Array, decoded: Uint8Array): LsbExtractedFile {
  return {
    name: embeddedName(offset, extension(mediaType)),
    mediaType,
    offset,
    bytes: compressed,
    text: evidenceText(decoded),
  };
}

function pngIdatStream(bytes: Uint8Array) {
  if (!startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return undefined;
  const parts: Uint8Array[] = [];
  let total = 0;
  let firstOffset = 0;
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = ((bytes[cursor] << 24) | (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3]) >>> 0;
    const end = cursor + 12 + length;
    if (end > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (type === "IDAT") {
      if (parts.length === 0) firstOffset = cursor + 8;
      const part = bytes.subarray(cursor + 8, cursor + 8 + length);
      parts.push(part);
      total += part.length;
    }
    cursor = end;
    if (type === "IEND") break;
  }
  if (parts.length < 2) return undefined;
  const data = new Uint8Array(total);
  let output = 0;
  for (const part of parts) {
    data.set(part, output);
    output += part.length;
  }
  return { data, offset: firstOffset, chunks: parts.length };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function fileKey(file: LsbExtractedFile) {
  return `${file.offset}:${file.mediaType}:${file.bytes.length}`;
}

async function scanLevel(
  bytes: Uint8Array,
  limits: ScanLimits,
  budget: ScanBudget,
  depth: number,
  includeRoot: boolean,
): Promise<LsbExtractedFile[]> {
  if (depth > limits.maxDepth || budget.candidates >= limits.maxCandidates) return [];
  const files: LsbExtractedFile[] = [];
  const seen = new Set<string>();
  const add = (file: LsbExtractedFile) => {
    if (budget.candidates >= limits.maxCandidates || seen.has(fileKey(file))) return false;
    seen.add(fileKey(file));
    budget.candidates += 1;
    files.push(file);
    return true;
  };

  const idat = pngIdatStream(bytes);
  if (idat && depth < limits.maxDepth) {
    const children = await scanLevel(idat.data, limits, budget, depth + 1, false);
    if (children.length > 0) add({
      name: `png-idat-${idat.chunks}-chunks.bin`,
      mediaType: "application/octet-stream",
      offset: idat.offset,
      bytes: idat.data,
      children,
    });
  }

  for (const carved of findEmbeddedFiles(bytes)) {
    if (!includeRoot && carved.offset === 0) continue;
    if (!add(carved)) continue;
    if ((carved.mediaType === "application/zip" || carved.mediaType === "application/gzip") && depth < limits.maxDepth) {
      carved.children = unpackArchive(carved.bytes, carved.mediaType, {
        maxEntries: limits.maxCandidates,
        maxTotalBytes: Math.max(1, limits.maxTotalBytes - budget.totalBytes),
        maxFileBytes: limits.maxFileBytes,
        maxCompressionRatio: limits.maxCompressionRatio,
      });
      for (const child of carved.children) {
        if (child.text === undefined && child.bytes.length > 0) child.text = evidenceText(child.bytes);
        if (child.bytes.length > 0 && reserveOutput(child.bytes, limits, budget)) child.children = await scanLevel(child.bytes, limits, budget, depth + 1, true);
      }
    } else if (depth < limits.maxDepth) carved.children = await scanLevel(carved.bytes, limits, budget, depth + 1, false);
  }

  let zlibAttempts = 0;
  for (let offset = 0; offset + 6 <= bytes.length && zlibAttempts < 128 && budget.candidates < limits.maxCandidates; offset += 1) {
    if (!isZlibHeader(bytes, offset)) continue;
    zlibAttempts += 1;
    const compressed = bytes.subarray(offset);
    const maximum = outputLimit(compressed.length, limits, budget);
    try {
      const decoded = unzlibSync(compressed, { out: new Uint8Array(maximum) });
      if (decoded.length >= maximum) {
        add(warning(embeddedName(offset, "zlib-warning.txt"), `Zlib 解压输出达到限制 ${maximum} 字节`, offset));
        continue;
      }
      const text = readableText(decoded);
      const embedded = findEmbeddedFiles(decoded);
      if (!text && embedded.length === 0) continue;
      if (!reserveOutput(decoded, limits, budget)) {
        add(warning(embeddedName(offset, "zlib-warning.txt"), "Zlib 解压输出超过总量限制", offset));
        continue;
      }
      const file = derivedFile("application/zlib", offset, compressed.slice(), decoded);
      file.children = await scanLevel(decoded, limits, budget, depth + 1, true);
      add(file);
    } catch {
      // A valid-looking header inside unrelated compressed data is not evidence by itself.
    }
  }

  for (let offset = 0; offset + 4 <= bytes.length && budget.candidates < limits.maxCandidates; offset += 1) {
    if (bytes[offset] !== 0x42 || bytes[offset + 1] !== 0x5a || bytes[offset + 2] !== 0x68 || bytes[offset + 3] < 0x31 || bytes[offset + 3] > 0x39) continue;
    const compressed = bytes.subarray(offset);
    const maximum = outputLimit(compressed.length, limits, budget);
    try {
      const decoded = await decodeBzip2(compressed, maximum);
      if (!reserveOutput(decoded, limits, budget)) throw new Error("BZip2 解压输出超过总量限制");
      const file = derivedFile("application/x-bzip2", offset, compressed.slice(), decoded);
      file.children = await scanLevel(decoded, limits, budget, depth + 1, true);
      add(file);
    } catch (error) {
      add(warning(embeddedName(offset, "bz2-warning.txt"), `BZip2 解压失败或触发限制：${error instanceof Error ? error.message : String(error)}`, offset));
    }
  }

  let lzmaAttempts = 0;
  for (let offset = 0; offset + 13 <= bytes.length && lzmaAttempts < 32 && budget.candidates < limits.maxCandidates; offset += 1) {
    if (!isLzmaHeader(bytes, offset, limits)) continue;
    lzmaAttempts += 1;
    const compressed = bytes.subarray(offset);
    const maximum = outputLimit(compressed.length, limits, budget);
    try {
      const decoded = await decodeLzma(compressed, maximum);
      if (!reserveOutput(decoded, limits, budget)) throw new Error("LZMA 解压输出超过总量限制");
      const text = readableText(decoded);
      const embedded = findEmbeddedFiles(decoded);
      if (!text && embedded.length === 0) continue;
      const file = derivedFile("application/x-lzma", offset, compressed.slice(), decoded);
      file.children = await scanLevel(decoded, limits, budget, depth + 1, true);
      add(file);
    } catch (error) {
      add(warning(embeddedName(offset, "lzma-warning.txt"), `LZMA 解压失败或触发限制：${error instanceof Error ? error.message : String(error)}`, offset));
    }
  }
  return files;
}

function flatten(files: LsbExtractedFile[]): LsbExtractedFile[] {
  return files.flatMap((file) => [file, ...flatten(file.children ?? [])]);
}

export async function scanEmbeddedContent(bytes: Uint8Array, options: EmbeddedScanOptions): Promise<EmbeddedScanResult> {
  const limits = normalizedLimits(options);
  const budget: ScanBudget = { candidates: 0, totalBytes: 0 };
  const files = await scanLevel(bytes, limits, budget, 0, false);
  const findings: StegoFinding[] = [];
  for (const file of flatten(files)) {
    if (!file.text) continue;
    for (const hit of detectFlags(file.text, limits.prefixes, limits.caseSensitive)) {
      if (findings.some((finding) => finding.detail === hit.text)) continue;
      const assessment = assessFlagCandidate(hit.text);
      findings.push({
        id: `carving-flag-${findings.length}`,
        severity: assessment.confidence === "high" ? "high" : "suspicious",
        source: `递归雕刻 · ${file.name}`,
        title: assessment.confidence === "high" ? "解压内容发现 Flag" : "解压内容疑似 Flag",
        detail: hit.text,
        offset: file.offset,
      });
    }
  }
  if (files.length > 0) findings.push({ id: "recursive-carving", severity: "info", source: "递归雕刻", title: `恢复 ${files.length} 个顶层候选`, detail: `扫描 ${budget.candidates} 个候选，累计解压 ${budget.totalBytes} 字节，最大深度 ${limits.maxDepth}` });
  return { files, findings };
}
