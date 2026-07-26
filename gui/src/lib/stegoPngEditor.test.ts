// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
import { strToU8, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { crc32 } from "./stegoBinary";
import { analyzePngChunkRepairs } from "./stegoPngEditor";

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

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

function png(...idats: Uint8Array<ArrayBufferLike>[]) {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", concat(u32be(1), u32be(1), Uint8Array.of(8, 2, 0, 0, 0))),
    ...idats.map((data) => chunk("IDAT", data)),
    chunk("IEND"),
  );
}

describe("PNG chunk repair analysis", () => {
  corpusIt.each([
    ["misc11.png", 1],
    ["misc12.png", 8],
  ])("removes the verified decoy IDAT prefix from %s", (name, removedChunks) => {
    const result = analyzePngChunkRepairs(new Uint8Array(readFileSync(`${corpus}\\${name}`)));

    expect(result.repairs).toContainEqual(expect.objectContaining({
      id: `png-drop-idat-prefix-${removedChunks}`,
      format: "PNG",
      confidence: "exact",
    }));
  });

  it("does not propose deletion for non-PNG input", () => {
    expect(analyzePngChunkRepairs(new Uint8Array(64))).toEqual({ repairs: [], findings: [] });
  });

  it("finds a valid IDAT combination when a decoy is interleaved", () => {
    const compressed = zlibSync(Uint8Array.of(0, 0x12, 0x34, 0x56));
    const split = Math.ceil(compressed.length / 2);
    const bytes = png(
      compressed.slice(0, split),
      Uint8Array.of(0xde, 0xad, 0xbe, 0xef),
      compressed.slice(split),
    );

    const result = analyzePngChunkRepairs(bytes);

    expect(result.repairs).toContainEqual(expect.objectContaining({
      format: "PNG",
      confidence: "exact",
      label: expect.stringContaining("#2"),
    }));
  });
});
