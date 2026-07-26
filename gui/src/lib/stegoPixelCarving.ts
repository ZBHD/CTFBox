import { unzlibSync } from "fflate";
import { readAscii, readU32 } from "./stegoBinary";

export type PngBmpReinterpretation =
  | { supported: true; width: number; height: number; bytes: Uint8Array }
  | { supported: false; reason: string };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const MAX_PIXEL_BYTES = 64 * 1024 * 1024;

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
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

function reverseFilter(row: Uint8Array, previous: Uint8Array, filter: number, bytesPerPixel: number) {
  const output = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
    const above = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] ?? 0 : 0;
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

function encodeBmp24(width: number, height: number, rgb: Uint8Array) {
  const rowStride = Math.ceil(width * 3 / 4) * 4;
  const pixelBytes = rowStride * height;
  const output = new Uint8Array(54 + pixelBytes);
  const view = new DataView(output.buffer);
  output.set([0x42, 0x4d]);
  view.setUint32(2, output.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 3780, true);
  view.setInt32(42, 3780, true);
  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = height - 1 - targetY;
    const sourceRow = sourceY * width * 3;
    const targetRow = 54 + targetY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * 3;
      const target = targetRow + x * 3;
      output[target] = rgb[source + 2];
      output[target + 1] = rgb[source + 1];
      output[target + 2] = rgb[source];
    }
  }
  return output;
}

export function reinterpretPngAsBmp(bytes: Uint8Array): PngBmpReinterpretation {
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return { supported: false, reason: "不是 PNG 文件" };
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawIhdr = false;
  let sawIend = false;
  let cursor = 8;
  const idat: Uint8Array[] = [];
  while (cursor + 12 <= bytes.length) {
    const length = readU32(bytes, cursor, "be");
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd < dataStart || dataEnd + 4 > bytes.length) return { supported: false, reason: "PNG 数据块被截断" };
    const type = readAscii(bytes, cursor + 4, 4);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) return { supported: false, reason: "PNG IHDR 无效" };
      width = readU32(data, 0, "be");
      height = readU32(data, 4, "be");
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return { supported: false, reason: "仅支持 8 位 RGB/RGBA PNG" };
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return { supported: false, reason: "暂不支持该 PNG 压缩、滤波或隔行模式" };
      channels = colorType === 2 ? 3 : 4;
      sawIhdr = true;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") {
      sawIend = true;
      break;
    }
    cursor = dataEnd + 4;
  }
  if (!sawIhdr || !sawIend || idat.length === 0 || width === 0 || height === 0) {
    return { supported: false, reason: "PNG 结构不完整" };
  }
  const rowBytes = width * channels;
  const filteredLength = height * (rowBytes + 1);
  const rgbLength = width * height * 3;
  if (!Number.isSafeInteger(filteredLength) || filteredLength > MAX_PIXEL_BYTES || rgbLength > MAX_PIXEL_BYTES) {
    return { supported: false, reason: "PNG 无损像素输出超过 64 MiB 限制" };
  }
  let filtered: Uint8Array;
  try {
    filtered = unzlibSync(concat(idat), { out: new Uint8Array(filteredLength) });
  } catch (error) {
    return { supported: false, reason: `PNG IDAT 解压失败：${error instanceof Error ? error.message : String(error)}` };
  }
  const rgb = new Uint8Array(rgbLength);
  let previous = new Uint8Array(rowBytes);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset++];
    if (filter > 4) return { supported: false, reason: `PNG 使用了无效滤波器 ${filter}` };
    const row = reverseFilter(filtered.subarray(inputOffset, inputOffset + rowBytes), previous, filter, channels);
    inputOffset += rowBytes;
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 3;
      rgb[target] = row[source];
      rgb[target + 1] = row[source + 1];
      rgb[target + 2] = row[source + 2];
    }
    previous = row;
  }
  return { supported: true, width, height, bytes: encodeBmp24(width, height, rgb) };
}
