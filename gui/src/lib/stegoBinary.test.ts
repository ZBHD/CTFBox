import { describe, expect, it } from "vitest";
import {
  StegoParseError,
  crc32,
  hexPreview,
  readAscii,
  readU16,
  readU32,
  shannonEntropy,
} from "./stegoBinary";

describe("stego binary helpers", () => {
  it("reads bounded integers and ASCII in both byte orders", () => {
    const bytes = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x41, 0x42);
    expect(readU16(bytes, 0, "be")).toBe(0x1234);
    expect(readU16(bytes, 0, "le")).toBe(0x3412);
    expect(readU32(bytes, 0, "be")).toBe(0x12345678);
    expect(readU32(bytes, 0, "le")).toBe(0x78563412);
    expect(readAscii(bytes, 4, 2)).toBe("AB");
    expect(() => readU32(bytes, 4, "be")).toThrowError(StegoParseError);
    expect(() => readU32(bytes, 4, "be")).toThrow("0x4");
  });

  it("calculates PNG-compatible CRC32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("calculates entropy and bounded hex previews", () => {
    expect(shannonEntropy(new Uint8Array(64))).toBe(0);
    expect(shannonEntropy(Uint8Array.from({ length: 256 }, (_, value) => value))).toBeCloseTo(8, 8);
    expect(hexPreview(Uint8Array.of(0, 1, 2, 3), 3)).toBe("00 01 02 ... (+1 bytes)");
  });
});
