// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeSpecialImagePixels } from "./stegoImageDecoder";
import { decodeTiffPixels, detectImageFormat, encodePngPixels, naturalSortImageParts, stitchImagePartsVertically } from "./stegoMagic";

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("magic-driven image handling", () => {
  corpusIt("detects renamed images by bytes across the misc2 and misc4 formats", () => {
    const paths = ["misc2.txt", ...Array.from({ length: 6 }, (_, index) => `misc4\\${index + 1}.txt`)];
    const formats = paths.map((path) => detectImageFormat(new Uint8Array(readFileSync(`${corpus}\\${path}`)))?.format);

    expect(formats).toEqual(["PNG", "PNG", "JPEG", "BMP", "GIF", "TIFF", "WEBP"]);
  });

  it("sorts shuffled parts by natural filename without using extensions", () => {
    const parts = [
      { name: "piece-10.payload" },
      { name: "piece-2.unknown" },
      { name: "piece-1.txt" },
    ];

    expect(naturalSortImageParts(parts).map((part) => part.name)).toEqual([
      "piece-1.txt",
      "piece-2.unknown",
      "piece-10.payload",
    ]);
  });

  it("stitches varying-width pixel parts vertically in sorted order", () => {
    const parts = naturalSortImageParts([
      { name: "3.bin", width: 1, height: 1, rgba: Uint8Array.of(30, 0, 0, 255) },
      { name: "1.bin", width: 3, height: 1, rgba: Uint8Array.of(10, 0, 0, 255, 11, 0, 0, 255, 12, 0, 0, 255) },
      { name: "2.bin", width: 2, height: 1, rgba: Uint8Array.of(20, 0, 0, 255, 21, 0, 0, 255) },
    ]);

    const stitched = stitchImagePartsVertically(parts);

    expect([stitched.width, stitched.height]).toEqual([3, 3]);
    expect([stitched.rgba[0], stitched.rgba[12], stitched.rgba[16], stitched.rgba[28]]).toEqual([10, 255, 20, 30]);
    expect(Array.from(encodePngPixels(stitched).subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  corpusIt("decodes the renamed TIFF part without browser image support", () => {
    const pixels = decodeTiffPixels(new Uint8Array(readFileSync(`${corpus}\\misc4\\5.txt`)));

    expect([pixels.width, pixels.height]).toEqual([900, 150]);
    expect(pixels.rgba.some((value, index) => index % 4 !== 3 && value < 128)).toBe(true);
  });

  corpusIt("dispatches BPG decoding by magic format without browser support", async () => {
    const pixels = await decodeSpecialImagePixels(new Uint8Array(readFileSync(`${corpus}\\misc3.bpg`)), "BPG");

    expect(pixels && [pixels.width, pixels.height]).toEqual([900, 150]);
  });
});
