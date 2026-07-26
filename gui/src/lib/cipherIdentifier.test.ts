import { describe, expect, it } from "vitest";
import { identifyCipherType } from "./cipherIdentifier";

describe("cipherIdentifier", () => {
  it("identifies base64", () => {
    const matches = identifyCipherType("SGVsbG8gV29ybGQ=");
    expect(matches.some((m) => m.type === "base64")).toBe(true);
  });

  it("identifies hex", () => {
    const matches = identifyCipherType("48656c6c6f");
    expect(matches.some((m) => m.type === "hex")).toBe(true);
  });

  it("identifies morse-like pattern", () => {
    const matches = identifyCipherType(".... . .-.. .-.. ---");
    expect(matches.some((m) => m.type === "morse")).toBe(true);
  });

  it("identifies caesar-like (only letters, reasonable IC)", () => {
    const matches = identifyCipherType("SYNTEBGGRFG");
    expect(matches.some((m) => m.type === "caesar" || m.type === "substitution")).toBe(true);
  });

  it("identifies binary format", () => {
    const matches = identifyCipherType("01001000 01100101 01101100 01101100 01101111");
    expect(matches.some((m) => m.type === "binary")).toBe(true);
  });

  it("handles empty input", () => {
    expect(identifyCipherType("")).toEqual([]);
  });
});
