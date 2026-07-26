import { describe, expect, it } from "vitest";
import { assessFlagCandidate, detectFlags } from "./flagDetector";

describe("global flag detector", () => {
  it("finds plain flags with custom prefixes", () => {
    expect(detectFlags("answer: CTF{plain_value}", ["flag", "CTF"], false)).toEqual([
      { text: "CTF{plain_value}", source: "plain" },
    ]);
  });

  it("decodes base64 tokens and reports the decoded flag", () => {
    expect(detectFlags("result=ZmxhZ3tiYXNlNjRfdGVzdH0=", ["flag"], false)).toEqual([
      {
        text: "flag{base64_test}",
        source: "base64",
        encoded: "ZmxhZ3tiYXNlNjRfdGVzdH0=",
      },
    ]);
  });

  it("respects case-sensitive matching", () => {
    expect(detectFlags("RkxBR3tDQVNFfQ==", ["flag"], true)).toEqual([]);
  });

  it("prefers the longest matching prefix over a generic suffix", () => {
    expect(detectFlags("NSSCTF{complete_prefix}", ["CTF", "NSSCTF"], false)).toEqual([
      { text: "NSSCTF{complete_prefix}", source: "plain" },
    ]);
  });

  it("ignores oversized Base64-like tokens before decoding", () => {
    const oversized = `ZmxhZ3tvdmVyc2l6ZWR9${"A".repeat(4096)}`;
    expect(detectFlags(oversized, ["flag"], false)).toEqual([]);
  });

  it("keeps very short brace matches as suspicious instead of final answers", () => {
    expect(assessFlagCandidate("ctfshow{32}")).toMatchObject({
      confidence: "suspicious",
      reason: expect.stringContaining("过短"),
    });
    expect(assessFlagCandidate("ctfshow{0cb07add909d0d60a92101a8b5c7223a}")).toMatchObject({
      confidence: "high",
    });
  });

  it("rejects low-diversity padding while accepting readable multi-token payloads", () => {
    expect(assessFlagCandidate("flag{aaaaaaaa}").confidence).toBe("suspicious");
    expect(assessFlagCandidate("flag{stage_two-result}").confidence).toBe("high");
  });
});
