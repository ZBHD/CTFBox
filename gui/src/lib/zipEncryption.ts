import { inflateSync } from "fflate";
import { detectFlags } from "./flagDetector";
import type { ZipEntryFinding, ZipMethod, ZipOptions, ZipProgress, ZipReport } from "./zipTypes";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const AES_EXTRA_ID = 0x9901;
const MAX_COMMENT = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipAnalysisInput {
  bytes: Uint8Array;
  options: ZipOptions;
  prefixes: readonly string[];
  caseSensitive: boolean;
}

interface ReadContext {
  bytes: Uint8Array;
  u16(offset: number): number;
  u32(offset: number): number;
}

function reader(bytes: Uint8Array): ReadContext {
  const u16 = (offset: number) => {
    if (offset + 2 > bytes.length) throw new Error("ZIP 结构越界");
    return bytes[offset] | (bytes[offset + 1] << 8);
  };
  const u32 = (offset: number) => {
    if (offset + 4 > bytes.length) throw new Error("ZIP 结构越界");
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  };
  return { bytes, u16, u32 };
}

function findEocd(context: ReadContext): number {
  const { bytes, u32 } = context;
  const lowerBound = Math.max(0, bytes.length - 22 - MAX_COMMENT);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (u32(offset) === SIG_EOCD) return offset;
  }
  throw new Error("无法解析为 ZIP 结构");
}

function classifyMethod(method: number, isAes: boolean): ZipMethod {
  if (isAes || method === 99) return "aes";
  if (method === 0) return "stored";
  if (method === 8) return "deflate";
  return "other";
}

function extraHasAes(bytes: Uint8Array, start: number, length: number): boolean {
  let cursor = start;
  const end = Math.min(start + length, bytes.length);
  while (cursor + 4 <= end) {
    const headerId = bytes[cursor] | (bytes[cursor + 1] << 8);
    const size = bytes[cursor + 2] | (bytes[cursor + 3] << 8);
    if (headerId === AES_EXTRA_ID) return true;
    cursor += 4 + size;
  }
  return false;
}

function decodeName(bytes: Uint8Array, start: number, length: number): string {
  const slice = bytes.subarray(start, Math.min(start + length, bytes.length));
  return new TextDecoder("utf-8").decode(slice);
}

function verifyPlaintext(
  method: ZipMethod,
  data: Uint8Array,
  expectedCrc: number,
): { verified: boolean; plaintext?: Uint8Array } {
  try {
    if (method === "stored") {
      return { verified: crc32(data) === expectedCrc, plaintext: data };
    }
    if (method === "deflate") {
      const plaintext = inflateSync(data);
      return { verified: crc32(plaintext) === expectedCrc, plaintext };
    }
  } catch {
    return { verified: false };
  }
  return { verified: false };
}

function severityFor(
  isAes: boolean,
  anyBit0: boolean,
  mismatch: boolean,
  verified: boolean,
): { severity: ZipEntryFinding["severity"]; verdict: string } | undefined {
  if (isAes) return { severity: "info", verdict: "真 AES 加密，不可伪修复" };
  if (verified && anyBit0) return { severity: "high", verdict: "确认伪加密，可安全修复" };
  if (verified) return undefined;
  if (mismatch) return { severity: "suspicious", verdict: "本地头与中央目录标记不一致，疑似伪加密（无法验证）" };
  if (anyBit0) return { severity: "suspicious", verdict: "疑似真加密（无法验证），仅报告" };
  return undefined;
}

export function analyzeZip(
  input: ZipAnalysisInput,
  hooks: { onProgress?: (progress: ZipProgress) => void } = {},
): ZipReport {
  const { bytes, prefixes, caseSensitive } = input;
  const context = reader(bytes);
  const eocd = findEocd(context);
  const total = context.u16(eocd + 10);
  let cursor = context.u32(eocd + 16);
  hooks.onProgress?.({ stage: "parse", completed: 0, total });

  const entries: ZipEntryFinding[] = [];
  const flagHits = new Set<string>();

  for (let index = 0; index < total; index += 1) {
    if (context.u32(cursor) !== SIG_CENTRAL) throw new Error("中央目录签名无效");
    const centralGpOffset = cursor + 8;
    const centralFlag = context.u16(centralGpOffset);
    const rawMethod = context.u16(cursor + 10);
    const crc = context.u32(cursor + 16);
    const compressedSize = context.u32(cursor + 20);
    const nameLength = context.u16(cursor + 28);
    const extraLength = context.u16(cursor + 30);
    const commentLength = context.u16(cursor + 32);
    const localHeaderStart = context.u32(cursor + 42);
    const name = decodeName(bytes, cursor + 46, nameLength);
    const isAes = rawMethod === 99 || extraHasAes(bytes, cursor + 46 + nameLength, extraLength);

    if (context.u32(localHeaderStart) !== SIG_LOCAL) throw new Error("本地文件头签名无效");
    const localGpOffset = localHeaderStart + 6;
    const localFlag = context.u16(localGpOffset);
    const localNameLength = context.u16(localHeaderStart + 26);
    const localExtraLength = context.u16(localHeaderStart + 28);
    const dataStart = localHeaderStart + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, Math.min(dataStart + compressedSize, bytes.length));

    const method = classifyMethod(rawMethod, isAes);
    const localBit0 = (localFlag & 1) === 1;
    const centralBit0 = (centralFlag & 1) === 1;
    const anyBit0 = localBit0 || centralBit0;
    const mismatch = localBit0 !== centralBit0;

    const { verified, plaintext } = isAes ? { verified: false, plaintext: undefined } : verifyPlaintext(method, data, crc);

    const entryFlags: string[] = [];
    if (plaintext) {
      for (const hit of detectFlags(new TextDecoder("utf-8").decode(plaintext), prefixes, caseSensitive)) {
        entryFlags.push(hit.text);
        flagHits.add(hit.text);
      }
    }

    const verdict = severityFor(isAes, anyBit0, mismatch, verified);
    if (verdict) {
      entries.push({
        name,
        method,
        localBit0,
        centralBit0,
        severity: verdict.severity,
        verdict: verdict.verdict,
        crcVerified: verified,
        localGpOffset,
        centralGpOffset,
        flagHits: entryFlags,
      });
    }

    cursor += 46 + nameLength + extraLength + commentLength;
    hooks.onProgress?.({ stage: "verify", completed: index + 1, total });
  }

  entries.sort((left, right) => (right.flagHits.length - left.flagHits.length) || severityRank(right.severity) - severityRank(left.severity));

  return {
    entryCount: total,
    entries,
    repairable: entries.filter((entry) => entry.severity === "high").length,
    flagHits: [...flagHits],
  };
}

function severityRank(severity: ZipEntryFinding["severity"]): number {
  return severity === "high" ? 2 : severity === "suspicious" ? 1 : 0;
}

export function repairZip(bytes: Uint8Array, report: ZipReport, options: ZipOptions): Uint8Array {
  const patched = bytes.slice();
  for (const entry of report.entries) {
    if (entry.severity !== "high") continue;
    if (options.checkLocalHeader) patched[entry.localGpOffset] &= 0xfe;
    if (options.checkCentralDirectory) patched[entry.centralGpOffset] &= 0xfe;
  }
  return patched;
}
