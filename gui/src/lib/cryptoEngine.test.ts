import { describe, expect, it } from "vitest";
import { decodeCandidates, processCrypto } from "./cryptoEngine";

describe("crypto processing engine", () => {
  it("encodes and decodes UTF-8 base64", async () => {
    const encoded = await processCrypto("encoding", "flag{中文}", { codec: "base64", direction: "encode" });
    expect(await processCrypto("encoding", encoded, { codec: "base64", direction: "decode" })).toBe("flag{中文}");
  });

  it("calculates SHA-256 in hexadecimal", async () => {
    expect(await processCrypto("hash", "abc", { algorithm: "SHA-256" })).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("applies a repeating XOR key", async () => {
    expect(await processCrypto("xor", "ABC", { key: "K", format: "hex" })).toBe("0a0908");
  });

  it.each([
    ["base32", "foo", "MZXW6==="],
    ["base58", "foo", "bQbp"],
    ["base85", "foo", "W^Zo"],
    ["ascii85", "foo", "AoDS"],
    ["html", "<foo & bar>", "&lt;foo &amp; bar&gt;"],
    ["unicode", "foo", "\\u0066\\u006f\\u006f"],
    ["binary", "foo", "01100110 01101111 01101111"],
    ["octal", "foo", "146 157 157"],
  ] as const)(
    "encodes a standard value and round-trips it with %s",
    async (codec, input, expected) => {
      const encoded = await processCrypto("encoding", input, { codec, direction: "encode" });
      expect(encoded).toBe(expected);
      expect(await processCrypto("encoding", encoded, { codec, direction: "decode" })).toBe(input);
    },
  );

  it("recursively decodes nested values, removes duplicates, and ranks flag results first", async () => {
    const base64 = await processCrypto("encoding", "flag{nested_result}", { codec: "base64", direction: "encode" });
    const nested = await processCrypto("encoding", base64, { codec: "hex", direction: "encode" });

    const results = decodeCandidates(nested, ["flag"], false, 3);

    expect(results[0]).toMatchObject({
      value: "flag{nested_result}",
      depth: 2,
      flags: ["flag{nested_result}"],
    });
    expect(results[0].path).toEqual(["Hex", "Base64"]);
    expect(new Set(results.map((result) => result.value)).size).toBe(results.length);
  });

  it("handles Ascii85 zero blocks followed by partial data", async () => {
    const input = "\u0000\u0000\u0000\u0000foo";
    const encoded = await processCrypto("encoding", input, { codec: "ascii85", direction: "encode" });
    expect(encoded).toBe("zAoDS");
    expect(await processCrypto("encoding", encoded, { codec: "ascii85", direction: "decode" })).toBe(input);
  });

  it("ignores invalid or unreadable automatic decode results", () => {
    expect(decodeCandidates("ordinary text", ["flag"], false, 3)).toEqual([]);
  });
});
