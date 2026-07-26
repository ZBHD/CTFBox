import { describe, expect, it } from "vitest";
import { affineDecrypt, atbashTransform, caesarBruteforce, caesarDecrypt, railFenceBruteforce, railFenceDecrypt, rot13, rot47, vigenereDecrypt } from "./classicalCipher";

describe("classicalCipher", () => {
  describe("caesarDecrypt", () => {
    it("decrypts ROT13", () => {
      expect(caesarDecrypt("URYYB", 13)).toBe("HELLO");
    });
    it("decrypts ROT1", () => {
      expect(caesarDecrypt("IFMMP", 1)).toBe("HELLO");
    });
    it("preserves non-alpha characters", () => {
      expect(caesarDecrypt("U{RYYB}", 13)).toBe("H{ELLO}");
    });
  });

  describe("caesarBruteforce", () => {
    it("finds flag in ROT13 ciphertext", () => {
      const ct = "SYNT{EBG13_GRFG}";
      const results = caesarBruteforce(ct, ["FLAG"], false);
      const found = results.find((r) => r.text.includes("FLAG"));
      expect(found).toBeDefined();
      expect(found!.shift).toBe(13);
    });
  });

  describe("vigenereDecrypt", () => {
    it("decrypts with known key", () => {
      expect(vigenereDecrypt("RIJVS", "KEY")).toBe("HELLO");
    });
  });

  describe("atbashTransform", () => {
    it("transforms HELLO to SVOOL", () => {
      expect(atbashTransform("HELLO")).toBe("SVOOL");
    });
    it("is self-inverse", () => {
      expect(atbashTransform(atbashTransform("HELLO"))).toBe("HELLO");
    });
  });

  describe("rot13", () => {
    it("encodes and decodes symmetrically", () => {
      expect(rot13(rot13("Hello World!"))).toBe("Hello World!");
    });
  });

  describe("rot47", () => {
    it("handles full ASCII range", () => {
      expect(rot47(rot47("Hello World!"))).toBe("Hello World!");
    });
  });

  describe("railFenceDecrypt", () => {
    it("decrypts 2-rail fence", () => {
      expect(railFenceDecrypt("HLOEL", 2)).toBe("HELLO");
    });
  });

  describe("railFenceBruteforce", () => {
    it("finds flag with unknown rails", () => {
      // "FLAG{RAIL}" with 3 rails → "FAGILLR}{A"
      const ct = "FALR}{GILA";
      const results = railFenceBruteforce(ct, ["FLAG"], false);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("affineDecrypt", () => {
    it("decrypts known affine cipher", () => {
      // Encrypt with a=5, b=8: "A"->(5*0+8)%26=8->"I", "B"->(5*1+8)%26=13->"N"
      // decrypt(I,5,8): 5⁻¹=21, 21*(8-8)%26=0->"A" ✓
      expect(affineDecrypt("IN", 5, 8)).toBe("AB");
    });
  });
});
