import * as UTIF from "utif2";
import UPNG from "upng-js";
import type { StegoPixelSource } from "./stegoTypes";

export type MagicImageFormat = "PNG" | "JPEG" | "BMP" | "GIF" | "TIFF" | "WEBP" | "BPG" | "ICO" | "AVIF";

export interface DetectedImageFormat {
  format: MagicImageFormat;
  mediaType: string;
  extension: string;
}

export interface NamedPixelSource extends StegoPixelSource {
  name: string;
}

const signatures: Array<DetectedImageFormat & { matches: (bytes: Uint8Array) => boolean }> = [
  { format: "PNG", mediaType: "image/png", extension: "png", matches: (bytes) => startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) },
  { format: "JPEG", mediaType: "image/jpeg", extension: "jpg", matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  { format: "BMP", mediaType: "image/bmp", extension: "bmp", matches: (bytes) => startsWith(bytes, [0x42, 0x4d]) },
  { format: "GIF", mediaType: "image/gif", extension: "gif", matches: (bytes) => startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) },
  { format: "TIFF", mediaType: "image/tiff", extension: "tif", matches: (bytes) => startsWith(bytes, [0x49, 0x49, 0x2a, 0]) || startsWith(bytes, [0x4d, 0x4d, 0, 0x2a]) },
  { format: "WEBP", mediaType: "image/webp", extension: "webp", matches: (bytes) => ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP") },
  { format: "BPG", mediaType: "image/bpg", extension: "bpg", matches: (bytes) => startsWith(bytes, [0x42, 0x50, 0x47, 0xfb]) },
  { format: "ICO", mediaType: "image/x-icon", extension: "ico", matches: (bytes) => startsWith(bytes, [0, 0, 1, 0]) },
  { format: "AVIF", mediaType: "image/avif", extension: "avif", matches: (bytes) => ascii(bytes, 4, "ftyp") && ["avif", "avis", "mif1"].includes(String.fromCharCode(...bytes.subarray(8, 12))) },
];

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, value: string) {
  return bytes.length >= offset + value.length && Array.from(value).every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function firstTagNumber(value: UTIF.TiffTag | number | Uint8Array | undefined) {
  if (typeof value === "number") return value;
  return Number(value?.[0] ?? 0);
}

export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat | undefined {
  const match = signatures.find((candidate) => candidate.matches(bytes));
  return match ? { format: match.format, mediaType: match.mediaType, extension: match.extension } : undefined;
}

export function naturalSortImageParts<T extends { name: string }>(parts: readonly T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return parts.map((part, index) => ({ part, index })).sort((left, right) =>
    collator.compare(left.part.name, right.part.name) || left.index - right.index,
  ).map(({ part }) => part);
}

export function stitchImagePartsVertically(parts: readonly NamedPixelSource[]): StegoPixelSource {
  if (parts.length < 1) throw new Error("没有可拼接的图片");
  const width = Math.max(...parts.map((part) => part.width));
  const height = parts.reduce((total, part) => total + part.height, 0);
  const decodedBytes = width * height * 4;
  if (width < 1 || height < 1 || width > 20_000 || height > 20_000 || decodedBytes > 256 * 1024 * 1024) {
    throw new Error(`拼接画布超过限制：${width} x ${height}`);
  }
  for (const part of parts) {
    if (part.width < 1 || part.height < 1 || part.rgba.length !== part.width * part.height * 4) throw new Error(`图片像素无效：${part.name}`);
  }
  const rgba = new Uint8Array(decodedBytes).fill(255);
  let top = 0;
  for (const part of parts) {
    const left = Math.round((width - part.width) / 2);
    for (let y = 0; y < part.height; y += 1) {
      const sourceStart = y * part.width * 4;
      const targetStart = ((top + y) * width + left) * 4;
      rgba.set(part.rgba.subarray(sourceStart, sourceStart + part.width * 4), targetStart);
    }
    top += part.height;
  }
  return { width, height, rgba };
}

export function decodeTiffPixels(bytes: Uint8Array): StegoPixelSource {
  const buffer = exactBuffer(bytes);
  const directories = UTIF.decode(buffer);
  const directory = directories.find((candidate) => firstTagNumber(candidate.t256) > 0 && firstTagNumber(candidate.t257) > 0) ?? directories[0];
  if (!directory) throw new Error("TIFF 不包含可解码图像目录");
  UTIF.decodeImage(buffer, directory);
  const rgba = UTIF.toRGBA8(directory);
  if (!directory.width || !directory.height || rgba.length !== directory.width * directory.height * 4) throw new Error("TIFF 像素尺寸无效");
  return { width: directory.width, height: directory.height, rgba };
}

export function encodePngPixels(source: StegoPixelSource) {
  const rgba = source.rgba.slice();
  return new Uint8Array(UPNG.encode([rgba.buffer], source.width, source.height, 0));
}
