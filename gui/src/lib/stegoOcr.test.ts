import { describe, expect, it, vi } from "vitest";
import type { StegoReport } from "./stegoTypes";
import { collectStegoOcrCandidates, normalizeStegoOcrSource, recognizeStegoCandidates } from "./stegoOcr";

function report(): StegoReport {
  return {
    format: "PNG",
    findings: [],
    sections: [],
    metadata: [],
    strings: [],
    visuals: [
      { id: "fft", label: "FFT", width: 1, height: 1, pixels: Uint8ClampedArray.of(255, 255, 255, 255) },
      { id: "apng-frame-004", label: "APNG 异常帧 4", width: 1, height: 1, pixels: Uint8ClampedArray.of(0, 0, 0, 255) },
      { id: "marker-f001-transposed", label: "F0 01 标记矩阵转置", width: 1, height: 1, pixels: Uint8ClampedArray.of(0, 0, 0, 255) },
      { id: "gif-offset-scatter", label: "GIF 帧偏移坐标", width: 1, height: 1, pixels: Uint8ClampedArray.of(0, 0, 0, 255) },
    ],
    carvedFiles: [
      { name: "payload.zip", mediaType: "application/zip", offset: 10, bytes: Uint8Array.of(1), children: [
        { name: "hidden.jpg", mediaType: "image/jpeg", offset: 2, bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) },
      ] },
    ],
    repairs: [
      { id: "repair", format: "PNG", label: "PNG 精确修复", width: 1, height: 1, confidence: "exact", detail: "CRC", bytes: Uint8Array.of(137, 80, 78, 71) },
    ],
  };
}

describe("stego OCR", () => {
  it("collects high-value coordinate, marker, animation, repair and nested carving images", () => {
    const candidates = collectStegoOcrCandidates(report());

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "visual:gif-offset-scatter",
      "visual:marker-f001-transposed",
      "visual:apng-frame-004",
      "repair:repair",
      "carved:payload.zip/hidden.jpg",
    ]);
    expect(candidates.every((candidate) => candidate.mediaType.startsWith("image/"))).toBe(true);
  });

  it("places a magic-detected source image before derived candidates", () => {
    const candidates = collectStegoOcrCandidates(report(), {
      source: { id: "source:input", label: "原始图片", mediaType: "image/png", bytes: Uint8Array.of(1, 2, 3) },
    });

    expect(candidates[0]).toMatchObject({ id: "source:input", label: "原始图片" });
  });

  it("normalizes decoded source pixels to PNG before OCR", () => {
    const source = normalizeStegoOcrSource({
      id: "source:input",
      label: "BPG 原始图片",
      mediaType: "image/bpg",
      bytes: Uint8Array.of(0x42, 0x50, 0x47, 0xfb),
    }, {
      width: 1,
      height: 1,
      rgba: Uint8Array.of(12, 34, 56, 255),
    });

    expect(source.mediaType).toBe("image/png");
    expect(Array.from(source.bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("turns whitespace-separated OCR text into assessed Flag findings", async () => {
    const recognize = vi.fn().mockResolvedValue({ text: "noise\nctfshow { ocr_123 }", confidence: 87 });

    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report()),
      ["ctfshow"],
      false,
      recognize,
      new AbortController().signal,
    );

    expect(recognize).toHaveBeenCalledTimes(5);
    expect(result.results[0]).toMatchObject({ sourceId: "visual:gif-offset-scatter", confidence: 87, flags: ["ctfshow{ocr_123}"] });
    expect(result.findings).toContainEqual(expect.objectContaining({ title: "OCR 发现 Flag", detail: "ctfshow{ocr_123}" }));
  });

  it("keeps a copyable suspected Flag when its prefix is not configured", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      [],
      false,
      async () => ({ text: "ctfshow{unconfigured_456}", confidence: 80 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{unconfigured_456}"]);
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "suspicious", title: "OCR 疑似 Flag" }));
  });

  it("repairs a bracket confused by OCR before joining segmented payload text", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      [],
      false,
      async () => ({ text: "ctfshow(\n4314e2b\n15ad9a9\n60e7d9d\n8fc2ff9\n02da}", confidence: 80 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{4314e2b15ad9a960e7d9d8fc2ff902da}"]);
  });

  it("repairs a closing brace confused with a square bracket at line end", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfshow{aade771916df7cde3009c0e631f9910d]", confidence: 64 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{aade771916df7cde3009c0e631f9910d}"]);
    expect(result.findings).toContainEqual(expect.objectContaining({ title: "OCR 发现 Flag" }));
  });

  it("corrects OCR character confusions in payload: O→0, l→1", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfsh0w{OOl_lOOks_fake}", confidence: 55 }),
      new AbortController().signal,
    );
    const allFlags = result.results[0].flags;
    // Payload fixes applied: O→0, l→1 inside {}
    // 'OOl_lOOks_fake' → '001_100ks_fake' (both l's in OOl and lOOks get →1)
    expect(allFlags).toContain("ctfsh0w{001_100ks_fake}");
  });

  it("normalizes a fully parenthesized complete hexadecimal Flag", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfshow(0123456789abcdef0123456789abcdef)", confidence: 52 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{0123456789abcdef0123456789abcdef}"]);
  });

  it("repairs a missing closing brace and removes an overlapping duplicate glyph", async () => {
    const expected = "ctfshow{0123456789abcdef0123456789abcdef}";
    const text = "ctfshow{00123456789abcdef0123456789abcdef";
    const symbols = [...text].map((symbol, index) => ({
      text: symbol,
      confidence: 98,
      bbox: { x0: index * 10, y0: 0, x1: index * 10 + 8, y1: 20 },
    }));
    const duplicateIndex = text.indexOf("00");
    symbols[duplicateIndex].bbox.x1 = symbols[duplicateIndex + 1].bbox.x1 - 1;

    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text, confidence: 60, symbols }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual([expected]);
  });

  it("repairs a closing brace recognized as a trailing hexadecimal glyph", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfshow{ce528f767fc465b8787cdb936363e6943", confidence: 64 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{ce528f767fc465b8787cdb936363e694}"]);
  });

  it("keeps bounded hexadecimal alternatives after explicit OCR confusion evidence", async () => {
    const expected = "ctfshow{dbf7d3f84b0125e833dfd3c80820a129}";
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfshow{dbf7d3184b012Se833dfd3c80820a129", confidence: 64 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toContain(expected);
    expect(result.results[0].flags.length).toBeLessThanOrEqual(8);
  });

  it("repairs hexadecimal confusions after bracket normalization and aligns a one-glyph OCR prefix", async () => {
    const expected = "ctfshow{dbf7d3f84b0125e833dfd3c80820a129}";
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctishow{dbf7d3184b012Se833dfd3c80820a129)", confidence: 0 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toContain(expected);
  });

  it("repairs a segmented hexadecimal Flag from stacked animation frames", async () => {
    const expected = "ctfshow{2056782cd57b13261dcbbe3d6eecda17}";
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfshow({\n\n2056782c\n\nd57b1326\n\n1dcbbe3d\n\n6eecdal?}", confidence: 73 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual([expected]);
  });

  it("keeps only the corrected complete hex Flag from one OCR recognition", async () => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: "ctfshow{aade771916df7cde3009c0e631f99l0d}", confidence: 64 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{aade771916df7cde3009c0e631f9910d}"]);
    expect(result.findings.map((finding) => finding.detail)).toEqual(["ctfshow{aade771916df7cde3009c0e631f9910d}"]);
  });

  it.each([
    ["ctfshow{0O123456789abcdef0123456789abcdef}", "ctfshow{0123456789abcdef0123456789abcdef}"],
    ["ctfshow{012345¢6789abcdef0123456789abcdef}", "ctfshow{0123456789abcdef0123456789abcdef}"],
    ["ctfshow{fedcbal10fedcba98fedcba10fedcba98}", "ctfshow{fedcba10fedcba98fedcba10fedcba98}"],
    ["ctfshow{abcdefl/10123456789abcdef01234567}", "ctfshow{abcdef110123456789abcdef01234567}"],
  ])("deletes one duplicated OCR confusion character from a 33-character payload", async (recognized, expected) => {
    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text: recognized, confidence: 60 }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual([expected]);
    expect(result.findings.map((finding) => finding.detail)).toEqual([expected]);
  });

  it("uses overlapping OCR symbol boxes to remove the duplicated glyph", async () => {
    const text = "ctfshow{03070al10ec3a3282bale352f4e07b0a9}";
    const symbols = [...text].map((symbol, index) => ({
      text: symbol,
      confidence: 98,
      bbox: { x0: index * 10, y0: 0, x1: index * 10 + 8, y1: 20 },
    }));
    const duplicatedIndex = text.indexOf("l");
    symbols[duplicatedIndex].bbox.x1 = symbols[duplicatedIndex + 1].bbox.x1 - 1;

    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text, confidence: 56, symbols }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual(["ctfshow{03070a10ec3a3282ba1e352f4e07b0a9}"]);
    expect(result.findings.map((finding) => finding.detail)).toEqual(["ctfshow{03070a10ec3a3282ba1e352f4e07b0a9}"]);
  });

  it("does not apply symbol offsets after whitespace compaction changes text length", async () => {
    const suffix = "0".repeat(31);
    const text = `ctfshow {lO${suffix}}`;
    const symbols = [...text].map((symbol, index) => ({
      text: symbol,
      confidence: 98,
      bbox: { x0: index * 10, y0: 0, x1: index * 10 + 8, y1: 20 },
    }));
    const duplicatedIndex = text.indexOf("l");
    symbols[duplicatedIndex].bbox.x1 = symbols[duplicatedIndex + 1].bbox.x1 - 1;

    const result = await recognizeStegoCandidates(
      collectStegoOcrCandidates(report(), { maximumCandidates: 1 }),
      ["ctfshow"],
      false,
      async () => ({ text, confidence: 56, symbols }),
      new AbortController().signal,
    );

    expect(result.results[0].flags).toEqual([
      `ctfshow{${"0".repeat(32)}}`,
      `ctfshow{1${suffix}}`,
    ]);
  });

  it("reserves OCR capacity for carved images when marker matrices are numerous", () => {
    const crowded = report();
    crowded.visuals = Array.from({ length: 24 }, (_, index) => ({
      id: `marker-f001-w${index + 8}-transposed`,
      label: `标记矩阵 ${index}`,
      width: 1,
      height: 1,
      pixels: Uint8ClampedArray.of(index, index, index, 255),
    }));

    const candidates = collectStegoOcrCandidates(crowded, { maximumCandidates: 8 });

    expect(candidates).toContainEqual(expect.objectContaining({ id: "carved:payload.zip/hidden.jpg" }));
    expect(candidates.filter((candidate) => candidate.id.startsWith("visual:marker-")).length).toBeLessThanOrEqual(6);
  });

  it("stops before recognition when cancellation is already requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const recognize = vi.fn();

    await expect(recognizeStegoCandidates([], [], false, recognize, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(recognize).not.toHaveBeenCalled();
  });
});
