import { describe, expect, it } from "vitest";
import { analyzeCrypto } from "./cryptaPipeline";
import { DEFAULT_CRYPTA_OPTIONS } from "./cryptaTypes";

describe("cryptaPipeline", () => {
  it("identifies and cracks Caesar ciphertext", async () => {
    const input = "SYNT{EBG13_GRFG}"; // ROT13 "FLAG{ROT13_TEST}"
    const report = await analyzeCrypto(input, ["FLAG"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.plaintextCandidates.some((c) => c.includes("FLAG"))).toBe(true);
  });

  it("identifies hash type", async () => {
    const input = "5d41402abc4b2a76b9719d911017c592"; // MD5("hello")
    const report = await analyzeCrypto(input, ["flag"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.findings.some((f) => f.source === "哈希" && f.title.includes("rainbow"))).toBe(false); // not in our small table
    expect(report.inputType).toBe("hash");
  });

  it("rainbow lookup finds known hash", async () => {
    const input = "5d41402abc4b2a76b9719d911017c592";
    const report = await analyzeCrypto(input, ["hello"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.plaintextCandidates).toContain("hello");
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeCrypto("test", ["flag"], false, DEFAULT_CRYPTA_OPTIONS, controller.signal),
    ).rejects.toThrow("分析已取消");
  });

  it("reports progress", async () => {
    const stages: string[] = [];
    await analyzeCrypto("test", ["flag"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal, (p) => stages.push(p.stage));
    expect(stages.length).toBeGreaterThan(0);
  });
});
