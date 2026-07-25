import { gunzipSync, unzipSync } from "fflate";
import type { LsbExtractedFile } from "./lsbTypes";

export interface ArchiveLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 512,
  maxTotalBytes: 256 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 500,
};

interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

function readU16Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function warning(message: string): LsbExtractedFile {
  return {
    name: "归档警告",
    mediaType: "text/plain",
    offset: 0,
    bytes: new Uint8Array(),
    text: message,
    warning: message,
  };
}

function findEocd(bytes: Uint8Array) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b || bytes[offset + 2] !== 0x05 || bytes[offset + 3] !== 0x06) continue;
    const commentLength = readU16Le(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  return -1;
}

function inspectZip(bytes: Uint8Array): ZipEntryInfo[] {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error("ZIP 缺少有效的中央目录结束记录");
  const count = readU16Le(bytes, eocd + 10);
  let cursor = readU32Le(bytes, eocd + 16);
  const entries: ZipEntryInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes[cursor] !== 0x50 || bytes[cursor + 1] !== 0x4b || bytes[cursor + 2] !== 0x01 || bytes[cursor + 3] !== 0x02) {
      throw new Error("ZIP 中央目录结构损坏");
    }
    const nameLength = readU16Le(bytes, cursor + 28);
    const extraLength = readU16Le(bytes, cursor + 30);
    const commentLength = readU16Le(bytes, cursor + 32);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error("ZIP 中央目录条目被截断");
    entries.push({
      name: new TextDecoder("utf-8").decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
      compressedSize: readU32Le(bytes, cursor + 20),
      uncompressedSize: readU32Le(bytes, cursor + 24),
    });
    cursor = end;
  }
  return entries;
}

function limitWarning(entries: ZipEntryInfo[], limits: ArchiveLimits) {
  if (entries.length > limits.maxEntries) return `归档条目数 ${entries.length} 超过限制 ${limits.maxEntries}`;
  const total = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (entries.some((entry) => entry.uncompressedSize > limits.maxFileBytes)) return `归档单文件大小超过限制 ${limits.maxFileBytes} 字节`;
  if (total > limits.maxTotalBytes) return `归档总解压大小 ${total} 超过限制 ${limits.maxTotalBytes} 字节`;
  const excessiveRatio = entries.some((entry) => entry.uncompressedSize > 0 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxCompressionRatio);
  if (excessiveRatio) return `归档压缩比超过限制 ${limits.maxCompressionRatio}:1`;
  return undefined;
}

function unsafePath(name: string) {
  const normalized = name.replace(/\\/g, "/");
  return normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").includes("..");
}

function decodedFile(name: string, bytes: Uint8Array): LsbExtractedFile {
  let text: string | undefined;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const printable = Array.from(decoded).filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length;
    if (decoded.length === 0 || printable / decoded.length >= 0.85) text = decoded;
  } catch {
    text = undefined;
  }
  return {
    name,
    mediaType: text !== undefined ? "text/plain" : "application/octet-stream",
    offset: 0,
    bytes,
    text,
  };
}

function unpackZip(bytes: Uint8Array, limits: ArchiveLimits): LsbExtractedFile[] {
  let entries: ZipEntryInfo[];
  try {
    entries = inspectZip(bytes);
  } catch (error) {
    return [warning(error instanceof Error ? error.message : "ZIP 结构损坏")];
  }
  const exceeded = limitWarning(entries, limits);
  if (exceeded) return [warning(exceeded)];

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes);
  } catch (error) {
    return [warning(`ZIP 解压失败：${error instanceof Error ? error.message : String(error)}`)];
  }

  const files: LsbExtractedFile[] = [];
  for (const [name, content] of Object.entries(unpacked)) {
    if (unsafePath(name)) {
      files.push(warning(`已忽略不安全路径：${name}`));
      continue;
    }
    files.push(decodedFile(name, content));
  }
  return files;
}

function unpackGzip(bytes: Uint8Array, limits: ArchiveLimits): LsbExtractedFile[] {
  if (bytes.length < 18) return [warning("GZIP 数据被截断")];
  const uncompressedSize = readU32Le(bytes, bytes.length - 4);
  if (uncompressedSize > limits.maxFileBytes) return [warning(`GZIP 单文件大小超过限制 ${limits.maxFileBytes} 字节`)];
  if (uncompressedSize > limits.maxTotalBytes) return [warning(`GZIP 总解压大小超过限制 ${limits.maxTotalBytes} 字节`)];
  if (uncompressedSize / Math.max(1, bytes.length) > limits.maxCompressionRatio) return [warning(`GZIP 压缩比超过限制 ${limits.maxCompressionRatio}:1`)];
  try {
    return [decodedFile("payload", gunzipSync(bytes))];
  } catch (error) {
    return [warning(`GZIP 解压失败：${error instanceof Error ? error.message : String(error)}`)];
  }
}

export function unpackArchive(
  bytes: Uint8Array,
  mediaType: "application/zip" | "application/gzip",
  limits = DEFAULT_ARCHIVE_LIMITS,
): LsbExtractedFile[] {
  return mediaType === "application/zip" ? unpackZip(bytes, limits) : unpackGzip(bytes, limits);
}
