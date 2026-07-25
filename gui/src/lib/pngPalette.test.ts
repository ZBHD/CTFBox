import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parsePaletteIndexes } from "./pngPalette";

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  return concat(u32be(data.length), typeBytes, data, u32be(crc32(concat(typeBytes, data))));
}

function paeth(left: number, above: number, upperLeft: number) {
  const value = left + above - upperLeft;
  const leftDistance = Math.abs(value - left);
  const aboveDistance = Math.abs(value - above);
  const upperLeftDistance = Math.abs(value - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function packRow(indexes: number[], bitDepth: 1 | 2 | 4 | 8) {
  const row = new Uint8Array(Math.ceil(indexes.length * bitDepth / 8));
  indexes.forEach((value, index) => {
    const bit = index * bitDepth;
    const shift = 8 - bitDepth - (bit % 8);
    row[Math.floor(bit / 8)] |= value << shift;
  });
  return row;
}

function filterRow(row: Uint8Array, previous: Uint8Array, filter: number) {
  return row.map((value, index) => {
    const left = index > 0 ? row[index - 1] : 0;
    const above = previous[index] ?? 0;
    const upperLeft = index > 0 ? previous[index - 1] : 0;
    const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
    return (value - predictor + 256) & 255;
  });
}

function makePalettePng(bitDepth: 1 | 2 | 4 | 8, filter: number, indexes: number[], options: { colorType?: number; interlace?: number } = {}) {
  const width = indexes.length / 2;
  const rows = [indexes.slice(0, width), indexes.slice(width)];
  const packed = rows.map((row) => packRow(row, bitDepth));
  const scanlines = concat(...packed.map((row, index) => concat(Uint8Array.of(filter), filterRow(row, packed[index - 1] ?? new Uint8Array(row.length), filter))));
  const ihdr = concat(
    u32be(width),
    u32be(2),
    Uint8Array.of(bitDepth, options.colorType ?? 3, 0, 0, options.interlace ?? 0),
  );
  const paletteEntries = 1 << bitDepth;
  const palette = Uint8Array.from({ length: paletteEntries * 3 }, (_, index) => index & 255);
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", ihdr),
    chunk("PLTE", palette),
    chunk("IDAT", zlibSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  );
}

describe("PNG palette index parsing", () => {
  const cases: Array<[1 | 2 | 4 | 8, number, number[]]> = [
    [1, 0, [0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1]],
    [2, 1, [0, 1, 2, 3, 3, 2, 1, 0]],
    [4, 2, [1, 4, 7, 15, 15, 7, 4, 1]],
    [8, 3, [1, 2, 127, 255, 255, 127, 2, 1]],
    [8, 4, [10, 20, 30, 40, 15, 25, 35, 45]],
  ];

  it.each(cases)("expands %i-bit indexes using filter %i", (bitDepth, filter, indexes) => {
    expect(parsePaletteIndexes(makePalettePng(bitDepth, filter, indexes))).toEqual({
      supported: true,
      width: indexes.length / 2,
      height: 2,
      indexes: Uint8Array.from(indexes),
    });
  });

  it("reports CRC corruption and truncated chunks", () => {
    const valid = makePalettePng(4, 0, [1, 2, 3, 4, 4, 3, 2, 1]);
    const corrupt = valid.slice();
    corrupt[29] ^= 1;

    expect(parsePaletteIndexes(corrupt)).toMatchObject({ supported: false, reason: expect.stringContaining("CRC") });
    expect(parsePaletteIndexes(valid.subarray(0, valid.length - 5))).toMatchObject({ supported: false, reason: expect.stringContaining("截断") });
  });

  it("declines Adam7 and non-palette PNG without throwing", () => {
    const indexes = [1, 2, 3, 4, 4, 3, 2, 1];
    expect(parsePaletteIndexes(makePalettePng(4, 0, indexes, { interlace: 1 }))).toMatchObject({ supported: false, reason: expect.stringContaining("Adam7") });
    expect(parsePaletteIndexes(makePalettePng(4, 0, indexes, { colorType: 2 }))).toMatchObject({ supported: false, reason: expect.stringContaining("色型 3") });
  });
});
