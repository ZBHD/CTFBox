// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeByteRecipes } from "./stegoByteRecipes";

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("byte recipe analysis", () => {
  it("extracts flags from bounded stride and residue combinations", () => {
    const bytes = new Uint8Array([
      0,
      ...Array.from(new TextEncoder().encode("ctfshow{stride_recipe}"), (byte) => [byte, 0x80]).flat(),
    ]);

    const result = analyzeByteRecipes(bytes, ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      source: "字节步长配方",
      value: "ctfshow{stride_recipe}",
    }));
  });

  it("discovers a configured flag at a stride above the old default", () => {
    const flag = new TextEncoder().encode("demo{stride_23_variant}");
    const stride = 23;
    const residue = 17;
    const bytes = new Uint8Array(residue + flag.length * stride).fill(0x80);
    flag.forEach((byte, index) => {
      bytes[residue + index * stride] = byte;
    });

    const result = analyzeByteRecipes(bytes, ["demo"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      label: `步长 ${stride}，余数 ${residue}`,
      value: "demo{stride_23_variant}",
    }));
  });

  it("infers non-default marker pairs and matrix row widths", () => {
    const columns = 12;
    const rows = 20;
    const marker = [0xab, 0xcd];
    const background = [0x12, 0x34];
    const bytes = Uint8Array.from({ length: columns * rows * 2 }, (_, offset) => {
      const cell = Math.floor(offset / 2);
      const pair = (cell + Math.floor(cell / columns)) % 3 === 0 ? marker : background;
      return pair[offset % 2];
    });

    const result = analyzeByteRecipes(bytes, ["demo"], false);

    expect(result.visuals).toContainEqual(expect.objectContaining({
      width: rows,
      height: columns,
      detail: expect.stringContaining("AB CD"),
    }));
  });

  corpusIt("recovers the verified stride candidate from misc13", () => {
    const bytes = new Uint8Array(readFileSync(`${corpus}\\misc13.png`));

    const result = analyzeByteRecipes(bytes, ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      value: "ctfshow{ae6e46c48f739b7eb2d1de6e412f839a}",
    }));
  });

  corpusIt("renders marker matrices from misc41", () => {
    const bytes = new Uint8Array(readFileSync(`${corpus}\\misc41.jpg`));

    const result = analyzeByteRecipes(bytes, ["ctfshow"], false);

    expect(result.visuals).toContainEqual(expect.objectContaining({
      id: "marker-f001-transposed",
      width: 124,
      height: 8,
    }));
    expect(result.visuals).toContainEqual(expect.objectContaining({
      id: "marker-f001-transposed-inverted",
      width: 124,
      height: 8,
    }));
  });
});
