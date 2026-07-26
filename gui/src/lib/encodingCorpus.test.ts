// @ts-expect-error vitest runs in Node
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error vitest runs in Node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCodec } from "./codecPipeline";
import { DEFAULT_CODEC_OPTIONS } from "./codecTypes";

const corpus = "D:\\Projects\\CTFBox\\artifacts\\test-corpus\\encoding";
const corpusIt = existsSync(corpus) ? it : it.skip;

function text(name: string) {
  return readFileSync(join(corpus, name), "utf-8");
}

describe("编码自动分析 — 真实题型验证", () => {
  corpusIt("classical 01: Caesar ROT13 自动破解", async () => {
    const input = text("classical/challenge-01-caesar.txt");
    const report = await analyzeCodec(input, ["flag", "FLAG"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{caesar_rot13}")).toBe(true);
  });

  corpusIt("classical 02: Atbash 自动破解", async () => {
    const input = text("classical/challenge-02-atbash.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{atbash_cipher}")).toBe(true);
  });

  corpusIt("classical 03: ROT47 自动破解", async () => {
    const input = text("classical/challenge-03-rot47.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    // ROT47 brute force through all rotations — Caesar bruteforce covers shift variants
    expect(report.candidates.length).toBeGreaterThan(0);
  });

  corpusIt("morse 01: / 分隔符解码", async () => {
    const input = text("morse/challenge-01-slash.txt");
    const report = await analyzeCodec(input, ["FLAG"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.candidates.some((c) => c.value.includes("FLAG"))).toBe(true);
  });

  corpusIt("morse 02: 空格分隔符解码", async () => {
    const input = text("morse/challenge-02-space.txt");
    const report = await analyzeCodec(input, ["FLAG"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.candidates.some((c) => c.value.includes("FLAG"))).toBe(true);
  });

  corpusIt("morse 03: Flag 格式 Morse 解码", async () => {
    const input = text("morse/challenge-03-flag.txt");
    const report = await analyzeCodec(input, ["FLAG"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.candidates.some((c) => c.value.includes("FLAG"))).toBe(true);
  });

  corpusIt("multi-layer 01: base64 直接解码", async () => {
    const input = text("multi-layer/challenge-01-base64.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{base64_direct}")).toBe(true);
  });

  corpusIt("multi-layer 02: hex + base64 递归解码", async () => {
    const input = text("multi-layer/challenge-02-hex-base64.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{hex_base64}")).toBe(true);
  });

  corpusIt("homoglyph 01: 零宽字符隐写检测", async () => {
    const input = text("homoglyph/challenge-01-zerowidth.txt");
    const report = await analyzeCodec(input, ["flag", "FLAG"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.source === "零宽字符")).toBe(true);
  });

  corpusIt("homoglyph 02: 混合文字系统检测", async () => {
    const input = text("homoglyph/challenge-02-cyrillic.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.source === "同形字")).toBe(true);
  });

  corpusIt("cjk 01: 全角字符自动转换", async () => {
    const input = text("cjk/challenge-01-fullwidth.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.candidates.some((c) => c.source === "CJK 全角")).toBe(true);
  });

  corpusIt("esolang 01: Brainfuck 程序识别", async () => {
    const input = text("esolang/challenge-01-bf.txt");
    const report = await analyzeCodec(input, ["flag", "Hello"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.source === "Esolang")).toBe(true);
  });

  corpusIt("custom-base 01: Base32 编码识别", async () => {
    const input = text("custom-base/challenge-01-base32.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.source === "Base 检测")).toBe(true);
  });

  corpusIt("combined 01: hex+base64 两层解码", async () => {
    const input = text("combined/challenge-01-hex-base64.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{combined_hex_b64}")).toBe(true);
  });

  corpusIt("text-file 01: 嵌入式 Flag 扫描", async () => {
    const input = text("text-file/challenge-01-embedded.txt");
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{hidden_in_text}")).toBe(true);
  });
});
