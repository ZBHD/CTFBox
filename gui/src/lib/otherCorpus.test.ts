// @ts-expect-error vitest runs in Node
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error vitest runs in Node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTextStego } from "./textStego";
import { identifyBarcode } from "./barcodeEngine";
import { analyzeOffice } from "./officeStego";

const corpus = "D:\\Projects\\CTFBox\\artifacts\\test-corpus\\other-stego";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("其他隐写 — 真实题型验证", () => {
  corpusIt("Text 01: 零宽字符隐写检测+提取", () => {
    const input = readFileSync(join(corpus, "text/challenge-01-zerowidth.txt"), "utf-8");
    const result = analyzeTextStego(input, ["flag"], false);
    expect(result.findings.some((f) => f.id === "zw-detect")).toBe(true);
    expect(result.candidates.some((c) => c.source === "零宽字符" && c.value.includes("flag"))).toBe(true);
  });

  corpusIt("Text 02: 大小写编码检测", () => {
    const input = readFileSync(join(corpus, "text/challenge-02-case.txt"), "utf-8");
    const result = analyzeTextStego(input, ["flag"], false);
    // Case encoding should be detected as a finding
    expect(result.findings.some((f) => f.id === "case-detect")).toBe(true);
    // Candidate should have the decoded payload
    expect(result.candidates.some((c) => c.source === "大小写编码")).toBe(true);
  });

  corpusIt("Text 03: 行尾空白检测", () => {
    const input = readFileSync(join(corpus, "text/challenge-03-trailing.txt"), "utf-8");
    const result = analyzeTextStego(input, ["flag"], false);
    expect(result.findings.some((f) => f.title.includes("行尾"))).toBe(true);
  });

  corpusIt("QR/Barcode 01: EAN-13 识别", () => {
    const input = readFileSync(join(corpus, "qrcode/challenge-01-ean13.txt"), "utf-8");
    const result = identifyBarcode(input);
    expect(result.type).toBe("EAN/UPC");
    expect(result.detected).toBe(true);
  });

  corpusIt("QR/Barcode 02: Code39 识别", () => {
    const input = readFileSync(join(corpus, "qrcode/challenge-02-code39.txt"), "utf-8");
    const result = identifyBarcode(input);
    expect(result.type).toBe("Code39");
    expect(result.detected).toBe(true);
  });

  corpusIt("Office 01: DOCX 隐藏文字检测", () => {
    const bytes = new Uint8Array(readFileSync(join(corpus, "office/challenge-01-hidden.docx")));
    const result = analyzeOffice(bytes, ["flag"], false);
    // Should detect vanish or hidden text
    expect(result.findings.some((f) => f.severity === "suspicious")).toBe(true);
  });
});
