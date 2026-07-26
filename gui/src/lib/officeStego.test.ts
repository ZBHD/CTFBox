import { describe, expect, it } from "vitest";
import { analyzeOffice } from "./officeStego";

describe("officeStego", () => {
  it("returns info for non-ZIP input", () => {
    const result = analyzeOffice(new Uint8Array([0, 1, 2, 3]), ["flag"], false);
    expect(result.findings.some((f) => f.title.includes("非 ZIP"))).toBe(true);
  });

  it("handles truncated ZIP gracefully", () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(100).fill(0)]);
    const result = analyzeOffice(buf, ["flag"], false);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
