import { describe, expect, it } from "vitest";
import { analyzeCodec } from "./codecPipeline";
import { DEFAULT_CODEC_OPTIONS } from "./codecTypes";

describe("codecPipeline", () => {
  it("detects and decodes base64 flag", async () => {
    const input = "ZmxhZ3t0ZXN0X2ZsYWd9"; // base64("flag{test_flag}")
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    const flagFinding = report.findings.find((f) => f.title.includes("Flag"));
    expect(flagFinding).toBeDefined();
    expect(flagFinding!.detail).toBe("flag{test_flag}");
  });

  it("detects and cracks caesar cipher", async () => {
    const input = "iodj{whvw_iodj}"; // caesar("flag{test_flag}", 3)
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.candidates.some((c) => c.value === "flag{test_flag}")).toBe(true);
  });

  it("decodes morse code", async () => {
    const input = "..-./.-../.-/--./-.--./--/-----/.-./..././..--.-/-.-./-----/-.././..--.-/--/.-/.../-/./.-./-.--.-";
    const report = await analyzeCodec(input, ["FLAG"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.candidates.some((c) => c.value === "FLAG{M0RSE_C0DE_MASTER}")).toBe(true);
  });

  it("detects zero-width stego", async () => {
    const input = "visible​‌‌text";
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.source === "零宽字符")).toBe(true);
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeCodec("test", ["flag"], false, DEFAULT_CODEC_OPTIONS, controller.signal),
    ).rejects.toThrow("分析已取消");
  });

  it("reports progress", async () => {
    const progressStages: string[] = [];
    await analyzeCodec(
      "test", ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal,
      (p) => progressStages.push(p.stage),
    );
    expect(progressStages.length).toBeGreaterThan(0);
  });

  it("decodes multi-layer encoding", async () => {
    // base64("flag{multi}")
    const input = "ZmxhZ3ttdWx0aX0=";
    const report = await analyzeCodec(input, ["flag"], false, DEFAULT_CODEC_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.detail === "flag{multi}")).toBe(true);
  });
});
