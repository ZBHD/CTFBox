// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeStego, DEFAULT_STEGO_OPTIONS } from "./stegoAnalyzer";
import type { StegoPixelSource } from "./stegoTypes";

const pixels: StegoPixelSource = {
  width: 8,
  height: 8,
  rgba: Uint8Array.from({ length: 8 * 8 * 4 }, (_, index) => index % 4 === 3 ? 255 : (Math.floor(index / 4) % 2) * 255),
};

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("combined stego analyzer", () => {
  it("runs enabled stages in order and combines their reports", async () => {
    const stages: string[] = [];
    const report = await analyzeStego({ fileName: "sample.bin", bytes: new TextEncoder().encode("ctfshow{inside}"), pixels }, DEFAULT_STEGO_OPTIONS, {
      signal: new AbortController().signal,
      onProgress: (progress) => stages.push(progress.stage),
    });

    expect(stages).toEqual(["structure", "channels", "dimensions", "carving", "metadata", "strings", "visuals", "dct", "frequency"]);
    expect(report.findings[0]).toMatchObject({ severity: "high", detail: "ctfshow{inside}" });
    expect(report.channels).toEqual([]);
    expect(report.repairs).toEqual([]);
    expect(report.visuals).toHaveLength(16);
    expect(report.visuals.at(-1)?.id).toBe("fft");
  });

  it("does not run disabled analysis families", async () => {
    const report = await analyzeStego({ fileName: "sample.bin", bytes: new TextEncoder().encode("ctfshow{hidden}"), pixels }, {
      ...DEFAULT_STEGO_OPTIONS,
      metadata: false,
      strings: false,
      visuals: false,
      dct: false,
      frequency: false,
      channels: false,
      dimensions: false,
      recursiveCarving: false,
    }, { signal: new AbortController().signal });

    expect(report.strings).toHaveLength(0);
    expect(report.visuals).toHaveLength(0);
    expect(report.dct).toBeUndefined();
    expect(report.channels).toHaveLength(0);
    expect(report.repairs).toHaveLength(0);
    expect(report.findings.every((finding) => finding.source !== "ASCII")).toBe(true);
  });

  it("aborts before expensive work starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyzeStego({ fileName: "sample.bin", bytes: new Uint8Array(128), pixels }, DEFAULT_STEGO_OPTIONS, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  corpusIt("reports the LZMA Flag from misc16 without a recursive-carving stage error", async () => {
    const report = await analyzeStego({
      fileName: "misc16.png",
      bytes: new Uint8Array(readFileSync(join(corpus, "misc16.png"))),
      prefixes: ["ctfshow"],
      caseSensitive: false,
    }, DEFAULT_STEGO_OPTIONS, { signal: new AbortController().signal });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: "high",
      detail: "ctfshow{a7e32f131c011290a62476ae77190b52}",
    }));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ title: "递归雕刻分析未完成" }));
  });
});
