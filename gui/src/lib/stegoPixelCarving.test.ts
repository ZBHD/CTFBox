// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
import { strToU8, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { crc32 } from "./stegoBinary";
import { scanEmbeddedContent } from "./stegoCarving";
import { reinterpretPngAsBmp } from "./stegoPixelCarving";

function concat(...parts: Uint8Array<ArrayBufferLike>[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function chunk(type: string, data: Uint8Array<ArrayBufferLike> = new Uint8Array()) {
  const body = concat(strToU8(type), data);
  return concat(u32be(data.length), body, u32be(crc32(body)));
}

function rgbPng(width: number, height: number, scanlines: Uint8Array) {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", concat(u32be(width), u32be(height), Uint8Array.of(8, 2, 0, 0, 0))),
    chunk("IDAT", zlibSync(scanlines)),
    chunk("IEND"),
  );
}

describe("lossless PNG pixel reinterpretation", () => {
  it("writes decoded RGB rows as a padded bottom-up 24-bit BMP", () => {
    const png = rgbPng(2, 2, Uint8Array.of(
      0, 255, 0, 0, 0, 255, 0,
      0, 0, 0, 255, 255, 255, 255,
    ));

    const result = reinterpretPngAsBmp(png);

    expect(result).toMatchObject({ supported: true, width: 2, height: 2 });
    if (!result.supported) return;
    expect(String.fromCharCode(...result.bytes.subarray(0, 2))).toBe("BM");
    expect(result.bytes.length).toBe(70);
    expect([...result.bytes.subarray(54)]).toEqual([
      255, 0, 0, 255, 255, 255, 0, 0,
      0, 0, 255, 0, 255, 0, 0, 0,
    ]);
  });

  const corpusFile = "D:\\Projects\\MiscTest\\misc45.png";
  const corpusIt = existsSync(corpusFile) ? it : it.skip;

  corpusIt("recovers the verified gzip and flag from misc45", async () => {
    const converted = reinterpretPngAsBmp(new Uint8Array(readFileSync(corpusFile)));
    expect(converted.supported).toBe(true);
    if (!converted.supported) return;
    expect([...converted.bytes.subarray(0x10000, 0x10003)]).toEqual([0x1f, 0x8b, 0x08]);

    const scan = await scanEmbeddedContent(converted.bytes, { prefixes: ["ctfshow"] });
    expect(scan.findings).toContainEqual(expect.objectContaining({
      detail: "ctfshow{057a722a5587979c34966c2436283e70}",
    }));
  });
});
