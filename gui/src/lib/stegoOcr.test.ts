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
  it("collects only high-value image candidates from animations, repairs and nested carving", () => {
    const candidates = collectStegoOcrCandidates(report());

    expect(candidates.map((candidate) => candidate.id)).toEqual([
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

    expect(recognize).toHaveBeenCalledTimes(3);
    expect(result.results[0]).toMatchObject({ sourceId: "visual:apng-frame-004", confidence: 87, flags: ["ctfshow{ocr_123}"] });
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

  it("stops before recognition when cancellation is already requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const recognize = vi.fn();

    await expect(recognizeStegoCandidates([], [], false, recognize, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(recognize).not.toHaveBeenCalled();
  });
});
