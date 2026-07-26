import { describe, expect, it } from "vitest";
import { detectDtmf } from "./audioDtmf";

describe("audioDtmf", () => {
  it("returns not detected for silence", () => {
    const silence = new Int32Array(8000); // 1 second at 8kHz
    const result = detectDtmf(silence, 8000);
    expect(result.detected).toBe(false);
  });

  it("returns not detected for insufficient data", () => {
    const result = detectDtmf(new Int32Array(100), 44100);
    expect(result.detected).toBe(false);
    expect(result.detail.includes("不足")).toBe(true);
  });
});
