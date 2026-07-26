import { unzlibSync } from "fflate";
import { readAscii, readU32 } from "./stegoBinary";
import type { StegoFinding, StegoRepairCandidate } from "./stegoTypes";

export interface PngChunkRepairResult {
  repairs: StegoRepairCandidate[];
  findings: StegoFinding[];
}

interface Chunk {
  type: string;
  start: number;
  end: number;
  data: Uint8Array;
}

const MAXIMUM_INFLATED_BYTES = 64 * 1024 * 1024;
const MAXIMUM_COMBINATION_IDATS = 12;

function isPng(bytes: Uint8Array) {
  return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
}

function parseChunks(bytes: Uint8Array) {
  const chunks: Chunk[] = [];
  let cursor = 8;
  while (cursor + 12 <= bytes.length && chunks.length < 100_000) {
    const length = readU32(bytes, cursor, "be");
    const end = cursor + length + 12;
    if (end > bytes.length) return [];
    const type = readAscii(bytes, cursor + 4, 4);
    chunks.push({ type, start: cursor, end, data: bytes.subarray(cursor + 8, cursor + 8 + length) });
    cursor = end;
    if (type === "IEND") return chunks;
  }
  return [];
}

function validZlibHeader(bytes: Uint8Array) {
  return bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8) | bytes[1]) % 31 === 0;
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function expectedInflatedLength(bytes: Uint8Array) {
  const width = readU32(bytes, 16, "be");
  const height = readU32(bytes, 20, "be");
  const bitDepth = bytes[24];
  const channels = bytes[25] === 0 ? 1 : bytes[25] === 2 ? 3 : bytes[25] === 3 ? 1 : bytes[25] === 4 ? 2 : bytes[25] === 6 ? 4 : 0;
  if (channels === 0 || bytes[28] !== 0 || width < 1 || height < 1) return undefined;
  const length = height * (1 + Math.ceil(width * bitDepth * channels / 8));
  return Number.isSafeInteger(length) && length <= MAXIMUM_INFLATED_BYTES ? length : undefined;
}

function inflateCandidate(parts: Uint8Array[], expectedLength: number | undefined) {
  if (expectedLength === undefined || parts.length === 0 || !validZlibHeader(parts[0])) return undefined;
  const compressedLength = parts.reduce((sum, part) => sum + part.length, 0);
  if (compressedLength > MAXIMUM_INFLATED_BYTES) return undefined;
  try {
    const inflated = unzlibSync(concat(parts), { out: new Uint8Array(expectedLength + 1) });
    return inflated.length === expectedLength ? inflated : undefined;
  } catch {
    return undefined;
  }
}

function rebuildWithoutIdats(bytes: Uint8Array, chunks: Chunk[], removed: Set<number>) {
  let idatIndex = 0;
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  for (const chunk of chunks) {
    if (chunk.type !== "IDAT" || !removed.has(idatIndex)) kept.push(bytes.subarray(chunk.start, chunk.end));
    if (chunk.type === "IDAT") idatIndex += 1;
  }
  return concat(kept);
}

export function analyzePngChunkRepairs(bytes: Uint8Array): PngChunkRepairResult {
  if (!isPng(bytes)) return { repairs: [], findings: [] };
  const chunks = parseChunks(bytes);
  const idats = chunks.filter((chunk) => chunk.type === "IDAT");
  if (idats.length < 2) return { repairs: [], findings: [] };
  const expectedLength = expectedInflatedLength(bytes);
  const repairs: StegoRepairCandidate[] = [];
  for (let boundary = 1; boundary < idats.length; boundary += 1) {
    const inflated = inflateCandidate(idats.slice(boundary).map((chunk) => chunk.data), expectedLength);
    if (!inflated) continue;
    const removed = new Set(Array.from({ length: boundary }, (_, index) => index));
    repairs.push({
      id: `png-drop-idat-prefix-${boundary}`,
      format: "PNG",
      label: `删除前 ${boundary} 个诱饵 IDAT`,
      width: readU32(bytes, 16, "be"),
      height: readU32(bytes, 20, "be"),
      confidence: "exact",
      detail: `第 ${boundary + 1} 个 IDAT 从独立合法 zlib 流开始，后续解压 ${inflated.length} 字节并与 IHDR 扫描线长度一致；原文件保持不变`,
      bytes: rebuildWithoutIdats(bytes, chunks, removed),
    });
  }
  if (idats.length <= MAXIMUM_COMBINATION_IDATS && expectedLength !== undefined) {
    const allMask = (1 << idats.length) - 1;
    for (let mask = 1; mask < allMask && repairs.length < 128; mask += 1) {
      const selected = idats.filter((_, index) => (mask & (1 << index)) !== 0);
      const removedIndexes = idats.map((_, index) => index).filter((index) => (mask & (1 << index)) === 0);
      if (removedIndexes.every((index, position) => index === position)) continue;
      const inflated = inflateCandidate(selected.map((chunk) => chunk.data), expectedLength);
      if (!inflated) continue;
      const removed = new Set(removedIndexes);
      const oneBased = removedIndexes.map((index) => `#${index + 1}`);
      repairs.push({
        id: `png-drop-idat-set-${removedIndexes.map((index) => index + 1).join("-")}`,
        format: "PNG",
        label: `删除诱饵 IDAT ${oneBased.join("、")}`,
        width: readU32(bytes, 16, "be"),
        height: readU32(bytes, 20, "be"),
        confidence: "exact",
        detail: `保留 ${selected.length}/${idats.length} 个 IDAT，按原顺序组合后解压 ${inflated.length} 字节并与 IHDR 扫描线长度一致；组合搜索上限 ${MAXIMUM_COMBINATION_IDATS} 块`,
        bytes: rebuildWithoutIdats(bytes, chunks, removed),
      });
    }
  }
  const findings: StegoFinding[] = repairs.length === 0 ? [] : [{
    id: "png-independent-idat-streams",
    severity: "suspicious",
    source: "PNG 块编辑",
    title: `发现 ${repairs.length} 个独立 IDAT 图层候选`,
    detail: repairs.map((repair) => repair.label).join(" · "),
  }];
  return { repairs, findings };
}
