import { describe, expect, it } from "vitest";
import { processCrypto } from "./cryptoEngine";

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
});
