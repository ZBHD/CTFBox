import BPGDecoder from "bpg-decoder/bpgdec.js";
import type { StegoPixelSource } from "./stegoTypes";

const BPG_MAGIC = [0x42, 0x50, 0x47, 0xfb] as const;
const MAX_BPG_BYTES = 64 * 1024 * 1024;
const MAX_BPG_DIMENSION = 20_000;
const MAX_BPG_RGBA_BYTES = 256 * 1024 * 1024;
const MAX_BPG_FRAMES = 64;

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readUe7(bytes: Uint8Array, start: number) {
  let value = 0;
  for (let offset = start; offset < bytes.length && offset < start + 5; offset += 1) {
    const byte = bytes[offset];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset + 1 };
  }
  throw new Error("BPG 数据不完整：尺寸字段已截断");
}

export function readBpgDimensions(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_BPG_BYTES) throw new Error("BPG 文件超过 64 MiB 限制");
  if (bytes.length < 7) throw new Error("BPG 数据不完整");
  if (!BPG_MAGIC.every((value, index) => bytes[index] === value)) throw new Error("文件不是 BPG 格式");

  const width = readUe7(bytes, 6);
  const height = readUe7(bytes, width.next);
  if (width.value < 1 || height.value < 1) throw new Error("BPG 图片尺寸无效");
  const rgbaBytes = width.value * height.value * 4;
  if (width.value > MAX_BPG_DIMENSION || height.value > MAX_BPG_DIMENSION || rgbaBytes > MAX_BPG_RGBA_BYTES) {
    throw new Error(`BPG 解码尺寸超过限制：${width.value} x ${height.value}`);
  }
  return { width: width.value, height: height.value };
}

export function decodeBpgPixels(bytes: Uint8Array): StegoPixelSource {
  const expected = readBpgDimensions(bytes);
  let decodedFrames = 0;
  const decoder = new BPGDecoder({
    createImageData(width, height) {
      decodedFrames += 1;
      if (decodedFrames > MAX_BPG_FRAMES) throw new Error(`BPG 动画超过 ${MAX_BPG_FRAMES} 帧限制`);
      if (width !== expected.width || height !== expected.height) throw new Error(`BPG 解码尺寸异常：${width} x ${height}`);
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
  });

  try {
    decoder._onload({ response: exactBuffer(bytes) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BPG")) throw error;
    throw new Error(`BPG 解码失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const image = decoder.imageData;
  if (!image || image.width !== expected.width || image.height !== expected.height || image.data.length !== image.width * image.height * 4) {
    throw new Error("BPG 解码结果无效");
  }
  return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
}
