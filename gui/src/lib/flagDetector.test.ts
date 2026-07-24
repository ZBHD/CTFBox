import { describe, expect, it } from "vitest";
import { detectFlags } from "./flagDetector";

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
});
