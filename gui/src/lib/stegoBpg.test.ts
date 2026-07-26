// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeBpgPixels } from "./stegoBpg";

const samplePath = "D:\\Projects\\MiscTest\\misc3.bpg";
const corpusIt = existsSync(samplePath) ? it : it.skip;

describe("offline BPG decoding", () => {
  corpusIt("decodes the real misc3 sample into RGBA pixels", () => {
    const pixels = decodeBpgPixels(new Uint8Array(readFileSync(samplePath)));

    expect([pixels.width, pixels.height]).toEqual([900, 150]);
    expect(pixels.rgba).toHaveLength(900 * 150 * 4);
    expect(pixels.rgba.some((value, index) => index % 4 !== 3 && value < 128)).toBe(true);
  });

  corpusIt("decodes a structurally equivalent sample with trailing noise", () => {
    const original = new Uint8Array(readFileSync(samplePath));
    const variant = new Uint8Array(original.length + 7);
    variant.set(original);
    variant.set([0x43, 0x54, 0x46, 0x42, 0x4f, 0x58, 0], original.length);

    const expected = decodeBpgPixels(original);
    const actual = decodeBpgPixels(variant);

    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(actual.rgba).toEqual(expected.rgba);
  });

  it("rejects truncated and oversized inputs before decoding", () => {
    expect(() => decodeBpgPixels(Uint8Array.of(0x42, 0x50, 0x47, 0xfb))).toThrow("BPG 数据不完整");
    expect(() => decodeBpgPixels(new Uint8Array(64 * 1024 * 1024 + 1))).toThrow("BPG 文件超过 64 MiB 限制");
  });
});
