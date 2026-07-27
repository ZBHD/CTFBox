// @ts-expect-error vitest runs in Node
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error vitest runs in Node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractStegoStrings } from "./stegoStrings";
import { analyzeStructure } from "./stegoStructure";
import { analyzePalette } from "./paletteStego";

const corpus = "D:\\Projects\\CTFBox\\artifacts\\test-corpus\\image-stego";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("图片隐写增强 — 真实题型验证", () => {
  corpusIt("Palette 01: 亮度排序调色板检测", () => {
    const bytes = new Uint8Array(readFileSync(join(corpus, "palette/challenge-01-luminance.bin")));
    const result = analyzePalette(bytes, undefined, ["flag"], false);
    expect(result.findings.some((f) => f.title.includes("亮度"))).toBe(true);
  });

  corpusIt("Combined 01: JPEG 文件尾附加数据", () => {
    const bytes = new Uint8Array(readFileSync(join(corpus, "combined/challenge-01-jpeg-trailing.jpg")));
    const structure = analyzeStructure(bytes);
    // Should detect trailing data after EOI
    const hasTrailing = structure.findings.some((f) => f.title.includes("附加数据"));
    // Or detect flag in strings
    const strings = extractStegoStrings(bytes, { minimumLength: 4, prefixes: ["flag"], caseSensitive: false });
    const hasFlag = strings.findings.some((f) => f.detail && f.detail.includes("flag{jpeg_trailing_data}"));
    expect(hasTrailing || hasFlag).toBe(true);
  });
});
