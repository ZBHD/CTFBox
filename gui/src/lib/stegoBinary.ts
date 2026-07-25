export type ByteOrder = "le" | "be";

export class StegoParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message}（偏移 0x${offset.toString(16)}）`);
    this.name = "StegoParseError";
  }
}

function requireRange(bytes: Uint8Array, offset: number, length: number) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new StegoParseError(`需要 ${length} 字节，文件长度 ${bytes.length}`, offset);
  }
}

export function readU16(bytes: Uint8Array, offset: number, order: ByteOrder) {
  requireRange(bytes, offset, 2);
  return order === "be"
    ? bytes[offset] * 0x100 + bytes[offset + 1]
    : bytes[offset] + bytes[offset + 1] * 0x100;
}

export function readU32(bytes: Uint8Array, offset: number, order: ByteOrder) {
  requireRange(bytes, offset, 4);
  if (order === "be") return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]) >>> 0;
  return (bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000) >>> 0;
}

export function readAscii(bytes: Uint8Array, offset: number, length: number) {
  requireRange(bytes, offset, length);
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

let crcTable: Uint32Array | undefined;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
  return crcTable;
}

export function crc32(bytes: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function shannonEntropy(bytes: Uint8Array) {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const byte of bytes) counts[byte] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const probability = count / bytes.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export function hexPreview(bytes: Uint8Array, limit = 256) {
  const shown = bytes.subarray(0, Math.max(0, limit));
  const body = Array.from(shown, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return bytes.length > shown.length ? `${body} ... (+${bytes.length - shown.length} bytes)` : body;
}
