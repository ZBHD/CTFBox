import { detectFlags } from "./flagDetector";
import { unpackArchive } from "./lsbArchive";
import type { LsbExtractedFile } from "./lsbTypes";

interface FileFormat {
  label: string;
  mediaType: string;
  extension: string;
  signature: readonly number[];
  boundary: (bytes: Uint8Array, offset: number) => number | undefined;
}

function readU16Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readU32Be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function findSequence(bytes: Uint8Array, sequence: readonly number[], start: number) {
  for (let offset = start; offset <= bytes.length - sequence.length; offset += 1) {
    if (matches(bytes, offset, sequence)) return offset;
  }
  return -1;
}

function pngBoundary(bytes: Uint8Array, offset: number) {
  let cursor = offset + 8;
  while (cursor + 12 <= bytes.length) {
    const length = readU32Be(bytes, cursor);
    const end = cursor + 12 + length;
    if (end > bytes.length) return undefined;
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (type === "IEND") return length === 0 ? end : undefined;
    cursor = end;
  }
  return undefined;
}

function markerBoundary(marker: readonly number[], minimumOffset: number) {
  return (bytes: Uint8Array, offset: number) => {
    const end = findSequence(bytes, marker, offset + minimumOffset);
    return end < 0 ? undefined : end + marker.length;
  };
}

function zipBoundary(bytes: Uint8Array, offset: number) {
  const marker = [0x50, 0x4b, 0x05, 0x06];
  for (let cursor = offset + 4; cursor <= bytes.length - 22; cursor += 1) {
    if (!matches(bytes, cursor, marker)) continue;
    const end = cursor + 22 + readU16Le(bytes, cursor + 20);
    if (end <= bytes.length) return end;
  }
  return undefined;
}

function lengthBoundary(lengthOffset: number, adjustment: number, minimum: number) {
  return (bytes: Uint8Array, offset: number) => {
    if (offset + lengthOffset + 4 > bytes.length) return undefined;
    const length = readU32Le(bytes, offset + lengthOffset) + adjustment;
    return length >= minimum && offset + length <= bytes.length ? offset + length : undefined;
  };
}

const FORMATS: FileFormat[] = [
  { label: "PNG", mediaType: "image/png", extension: "png", signature: [137, 80, 78, 71, 13, 10, 26, 10], boundary: pngBoundary },
  { label: "JPEG", mediaType: "image/jpeg", extension: "jpg", signature: [0xff, 0xd8, 0xff], boundary: markerBoundary([0xff, 0xd9], 3) },
  { label: "GIF", mediaType: "image/gif", extension: "gif", signature: [0x47, 0x49, 0x46, 0x38], boundary: markerBoundary([0x3b], 6) },
  { label: "ZIP", mediaType: "application/zip", extension: "zip", signature: [0x50, 0x4b, 0x03, 0x04], boundary: zipBoundary },
  { label: "GZIP", mediaType: "application/gzip", extension: "gz", signature: [0x1f, 0x8b, 0x08], boundary: (bytes) => bytes.length },
  { label: "PDF", mediaType: "application/pdf", extension: "pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d], boundary: markerBoundary([0x25, 0x25, 0x45, 0x4f, 0x46], 5) },
  { label: "7z", mediaType: "application/x-7z-compressed", extension: "7z", signature: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], boundary: (bytes) => bytes.length },
  { label: "RAR", mediaType: "application/vnd.rar", extension: "rar", signature: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], boundary: (bytes) => bytes.length },
  { label: "BMP", mediaType: "image/bmp", extension: "bmp", signature: [0x42, 0x4d], boundary: lengthBoundary(2, 0, 14) },
  { label: "WAV", mediaType: "audio/wav", extension: "wav", signature: [0x52, 0x49, 0x46, 0x46], boundary: lengthBoundary(4, 8, 12) },
  { label: "ELF", mediaType: "application/x-elf", extension: "elf", signature: [0x7f, 0x45, 0x4c, 0x46], boundary: (bytes) => bytes.length },
];

export function bytesToHexPreview(bytes: Uint8Array, limit = 256): string {
  const bounded = bytes.subarray(0, limit);
  const lines: string[] = [];
  for (let offset = 0; offset < bounded.length; offset += 16) {
    const values = Array.from(bounded.subarray(offset, offset + 16), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${values}`);
  }
  if (bytes.length > limit) lines.push(`... 省略 ${bytes.length - limit} 字节`);
  return lines.join("\n");
}

export function decodeTextPreview(bytes: Uint8Array, limit = 4096): { text: string; printableRatio: number } {
  const bounded = bytes.subarray(0, limit);
  const text = new TextDecoder("utf-8").decode(bounded);
  if (!text) return { text: "", printableRatio: 0 };
  const printable = Array.from(text).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\n" || character === "\r" || character === "\t" || (code >= 32 && code !== 0x7f && code !== 0xfffd);
  }).length;
  return { text, printableRatio: printable / Array.from(text).length };
}

export function findEmbeddedFiles(bytes: Uint8Array): LsbExtractedFile[] {
  const files: LsbExtractedFile[] = [];
  for (const format of FORMATS) {
    for (let offset = 0; offset <= bytes.length - format.signature.length; offset += 1) {
      if (!matches(bytes, offset, format.signature)) continue;
      const end = format.boundary(bytes, offset);
      if (end === undefined || end <= offset) continue;
      files.push({
        name: `carved-${offset}.${format.extension}`,
        mediaType: format.mediaType,
        offset,
        bytes: bytes.slice(offset, end),
      });
    }
  }
  return files.sort((left, right) => left.offset - right.offset || right.bytes.length - left.bytes.length);
}

function longestPrintableAsciiRun(bytes: Uint8Array) {
  let longest = 0;
  let current = 0;
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      current += 1;
      longest = Math.max(longest, current);
    } else current = 0;
  }
  return longest;
}

export function scoreLsbPayload(bytes: Uint8Array, prefixes: readonly string[], caseSensitive: boolean) {
  const evidence: string[] = [];
  const { text, printableRatio } = decodeTextPreview(bytes);
  const flags = detectFlags(text, prefixes, caseSensitive);
  const files = findEmbeddedFiles(bytes);
  let score = bytes.length === 0 ? -100 : 0;

  for (const hit of flags) {
    score += hit.source === "plain" ? 120 : 90;
    evidence.push(`发现 Flag：${hit.text}`);
  }

  if (printableRatio >= 0.85 && text.length >= 4) {
    score += 30;
    evidence.push(`可打印文本比例 ${Math.round(printableRatio * 100)}%`);
  }
  const longestRun = longestPrintableAsciiRun(bytes.subarray(0, 8192));
  if (longestRun >= 8) {
    score += Math.min(20, Math.floor(longestRun / 4));
    evidence.push(`连续可打印文本 ${longestRun} 字节`);
  }

  for (const file of files) {
    const format = FORMATS.find((item) => item.mediaType === file.mediaType);
    score += file.offset === 0 ? 55 : 40;
    evidence.push(`识别到 ${format?.label ?? file.mediaType} 文件（偏移 ${file.offset}）`);
    if (file.mediaType === "application/zip" || file.mediaType === "application/gzip") {
      file.children = unpackArchive(file.bytes, file.mediaType);
      for (const child of file.children) {
        if (!child.text) continue;
        for (const hit of detectFlags(child.text, prefixes, caseSensitive)) {
          score += 100;
          evidence.push(`归档内发现 Flag：${hit.text}`);
        }
      }
    }
  }

  if (bytes.length > 0) {
    const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
    const zeroRatio = sample.filter((byte) => byte === 0).length / sample.length;
    const unique = new Set(sample).size;
    if (zeroRatio >= 0.8) {
      score -= 60;
      evidence.push("大量零字节");
    }
    if (unique <= 2) score -= 20;
  }

  const firstFile = files[0];
  const mediaType = firstFile?.mediaType ?? (printableRatio >= 0.75 ? "text/plain" : "application/octet-stream");
  const preview = printableRatio >= 0.6 ? text : bytesToHexPreview(bytes);
  return { score, evidence, preview, mediaType, files };
}
