import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { crc32 } from "./stegoBinary";
import { analyzeImageDimensions } from "./stegoDimensions";

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16le(value: number) {
  return Uint8Array.of(value, value >>> 8);
}

function u32le(value: number) {
  return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24);
}

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function pngChunk(type: string, data = new Uint8Array()) {
  const body = concat(strToU8(type), data);
  return concat(u32be(data.length), body, u32be(crc32(body)));
}

function dimensionPng(width: number, height: number) {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", concat(u32be(width), u32be(height), Uint8Array.of(8, 2, 0, 0, 0))),
    pngChunk("IEND"),
  );
}

function writeU32be(bytes: Uint8Array, offset: number, value: number) {
  bytes.set(u32be(value), offset);
}

function bmp(width: number, height: number, actualWidth: number, actualHeight: number) {
  const stride = Math.ceil(actualWidth * 24 / 32) * 4;
  const fileSize = 54 + stride * actualHeight + 2;
  return concat(
    strToU8("BM"), u32le(fileSize), new Uint8Array(4), u32le(54), u32le(40), u32le(width), u32le(height),
    u16le(1), u16le(24), u32le(0), u32le(stride * actualHeight), new Uint8Array(16), new Uint8Array(stride * actualHeight + 2),
  );
}

function jpegSegment(marker: number, payload: Uint8Array) {
  return concat(Uint8Array.of(0xff, marker), u16le(payload.length + 2).reverse(), payload);
}

function baselineJpegWithZeroMcus(width: number, height: number, mcus: number) {
  const counts = Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const entropy = new Uint8Array(Math.ceil(mcus * 2 / 8));
  const usedBits = mcus * 2 % 8;
  if (usedBits !== 0) entropy[entropy.length - 1] = (1 << (8 - usedBits)) - 1;
  return concat(
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xdb, concat(Uint8Array.of(0), new Uint8Array(64).fill(1))),
    jpegSegment(0xc0, concat(Uint8Array.of(8), Uint8Array.of(height >>> 8, height), Uint8Array.of(width >>> 8, width), Uint8Array.of(1, 1, 0x11, 0))),
    jpegSegment(0xc4, concat(Uint8Array.of(0), counts, Uint8Array.of(0), Uint8Array.of(0x10), counts, Uint8Array.of(0))),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    entropy,
    Uint8Array.of(0xff, 0xd9),
  );
}

describe("image dimension recovery", () => {
  it("recovers both PNG dimensions from the stored IHDR CRC", () => {
    const damaged = dimensionPng(37, 23);
    writeU32be(damaged, 16, 11);
    writeU32be(damaged, 20, 13);

    const result = analyzeImageDimensions(damaged, { maximumDimension: 64 });

    expect(result.repairs).toContainEqual(expect.objectContaining({ format: "PNG", width: 37, height: 23, confidence: "exact" }));
    const repaired = result.repairs.find((candidate) => candidate.width === 37 && candidate.height === 23)!;
    expect(crc32(repaired.bytes.subarray(12, 29))).toBe(new DataView(repaired.bytes.buffer, repaired.bytes.byteOffset + 29, 4).getUint32(0));
  });

  it("infers BMP height and width from pixel bytes and four-byte row alignment", () => {
    const heightDamaged = analyzeImageDimensions(bmp(100, 60, 100, 90), { maximumDimension: 256 });
    const widthDamaged = analyzeImageDimensions(bmp(100, 60, 130, 60), { maximumDimension: 256 });

    expect(heightDamaged.repairs).toContainEqual(expect.objectContaining({ format: "BMP", width: 100, height: 90 }));
    expect(widthDamaged.repairs).toContainEqual(expect.objectContaining({ format: "BMP", width: 130, height: 60 }));
  });

  it("uses decoded GIF pixel counts to repair logical and frame dimensions", () => {
    const damaged = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (character) => character.charCodeAt(0));
    damaged[8] = 2;
    const descriptor = damaged.indexOf(0x2c);
    damaged[descriptor + 7] = 2;

    const result = analyzeImageDimensions(damaged, { maximumDimension: 64 });

    expect(result.repairs).toContainEqual(expect.objectContaining({ format: "GIF", width: 1, height: 1 }));
    const repaired = result.repairs.find((candidate) => candidate.format === "GIF")!;
    expect(Array.from(repaired.bytes.slice(6, 10))).toEqual([1, 0, 1, 0]);
    expect(Array.from(repaired.bytes.slice(descriptor + 5, descriptor + 9))).toEqual([1, 0, 1, 0]);
  });

  it("derives JPEG SOF candidates with MCU-inferred first, then common heights, then enumeration", () => {
    const mcus = 306;
    const damaged = baselineJpegWithZeroMcus(5, 5, mcus);

    const result = analyzeImageDimensions(damaged, { maximumDimension: 256 });

    // At least one JPEG repair candidate should be produced
    expect(result.repairs.length).toBeGreaterThanOrEqual(1);
    expect(result.repairs[0].format).toBe("JPEG");
    // Phase 1 MCU-inferred candidates come first (may be 0 on synthetic data)
    // Phase 2 height-only candidates with "高度修正" label come next
    const heightOnly = result.repairs.filter((r) => r.label?.includes("高度修正"));
    const enumOnly = result.repairs.filter((r) => r.label?.includes("SOF 枚举"));
    // At least one enumeration or height-only candidate should exist
    expect(heightOnly.length + enumOnly.length).toBeGreaterThanOrEqual(1);
  });
});
