import { unzlibSync } from "fflate";

export type PaletteParseResult =
  | { supported: true; width: number; height: number; indexes: Uint8Array }
  | { supported: false; reason: string };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function readU32Be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function paeth(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function reverseFilter(row: Uint8Array, previous: Uint8Array, filter: number) {
  const output = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index > 0 ? output[index - 1] : 0;
    const above = previous[index] ?? 0;
    const upperLeft = index > 0 ? previous[index - 1] : 0;
    const predictor = filter === 1
      ? left
      : filter === 2
        ? above
        : filter === 3
          ? Math.floor((left + above) / 2)
          : filter === 4
            ? paeth(left, above, upperLeft)
            : 0;
    output[index] = (row[index] + predictor) & 255;
  }
  return output;
}

export function parsePaletteIndexes(bytes: Uint8Array): PaletteParseResult {
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return { supported: false, reason: "不是有效的 PNG 文件" };
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let paletteEntries = 0;
  let sawIhdr = false;
  let sawIend = false;
  let cursor = 8;
  const idatParts: Uint8Array[] = [];

  while (cursor < bytes.length) {
    if (cursor + 12 > bytes.length) return { supported: false, reason: "PNG 数据块被截断" };
    const length = readU32Be(bytes, cursor);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4;
    if (dataEnd < dataStart || next > bytes.length) return { supported: false, reason: "PNG 数据块被截断" };
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    const expectedCrc = readU32Be(bytes, dataEnd);
    const actualCrc = crc32(bytes.subarray(cursor + 4, dataEnd));
    if (expectedCrc !== actualCrc) return { supported: false, reason: `${type} 数据块 CRC 校验失败` };

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) return { supported: false, reason: "IHDR 数据块无效" };
      width = readU32Be(data, 0);
      height = readU32Be(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      sawIhdr = true;
    } else if (type === "PLTE") {
      if (length === 0 || length % 3 !== 0 || length > 768) return { supported: false, reason: "PLTE 数据块无效" };
      paletteEntries = length / 3;
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      if (length !== 0) return { supported: false, reason: "IEND 数据块无效" };
      sawIend = true;
      break;
    }
    cursor = next;
  }

  if (!sawIhdr || !sawIend) return { supported: false, reason: "PNG 结构被截断" };
  if (width === 0 || height === 0) return { supported: false, reason: "PNG 图片尺寸无效" };
  if (colorType !== 3) return { supported: false, reason: "仅支持 PNG 调色板色型 3" };
  if (![1, 2, 4, 8].includes(bitDepth)) return { supported: false, reason: `不支持 ${bitDepth} 位调色板索引` };
  if (interlace !== 0) return { supported: false, reason: "暂不支持 Adam7 隔行 PNG" };
  if (paletteEntries === 0) return { supported: false, reason: "PNG 缺少 PLTE 调色板" };
  if (idatParts.length === 0) return { supported: false, reason: "PNG 缺少 IDAT 像素数据" };

  let filtered: Uint8Array;
  try {
    filtered = unzlibSync(concat(idatParts));
  } catch (error) {
    return { supported: false, reason: `IDAT 解压失败：${error instanceof Error ? error.message : String(error)}` };
  }

  const rowBytes = Math.ceil(width * bitDepth / 8);
  const expectedLength = height * (rowBytes + 1);
  if (filtered.length !== expectedLength) return { supported: false, reason: "IDAT 解压长度与图片尺寸不匹配" };

  const indexes = new Uint8Array(width * height);
  let previous = new Uint8Array(rowBytes);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset++];
    if (filter > 4) return { supported: false, reason: `PNG 使用了无效滤波器 ${filter}` };
    const row = reverseFilter(filtered.subarray(inputOffset, inputOffset + rowBytes), previous, filter);
    inputOffset += rowBytes;
    for (let x = 0; x < width; x += 1) {
      const bitOffset = x * bitDepth;
      const shift = 8 - bitDepth - (bitOffset % 8);
      const index = (row[Math.floor(bitOffset / 8)] >> shift) & ((1 << bitDepth) - 1);
      if (index >= paletteEntries) return { supported: false, reason: `像素引用了不存在的调色板索引 ${index}` };
      indexes[y * width + x] = index;
    }
    previous = row;
  }

  return { supported: true, width, height, indexes };
}
