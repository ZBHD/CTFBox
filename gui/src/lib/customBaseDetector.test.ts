import { describe, expect, it } from "vitest";
import { detectCustomBase } from "./customBaseDetector";

describe("customBaseDetector", () => {
  it("identifies standard base64", () => {
    const result = detectCustomBase("SGVsbG8=");
    expect(result.detected).toBe(true);
    expect(result.baseType).toBe("base64");
  });

  it("identifies base32", () => {
    const result = detectCustomBase("JBSWY3DP");
    expect(result.detected).toBe(true);
    expect(result.baseType).toBe("base32");
  });

  it("identifies base58 (Bitcoin)", () => {
    const result = detectCustomBase("2gPihY3TWG8vHW");
    expect(result.detected).toBe(true);
    expect(result.baseType).toBe("base58");
  });

  it("returns not detected for plain text", () => {
    const result = detectCustomBase("hello world");
    expect(result.detected).toBe(false);
  });

  it("handles empty input", () => {
    const result = detectCustomBase("");
    expect(result.detected).toBe(false);
  });
});
