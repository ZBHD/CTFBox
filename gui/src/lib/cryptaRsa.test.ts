import { describe, expect, it } from "vitest";
import { commonModulusAttack, fermatFactor, modPow, parseRsaPem } from "./cryptaRsa";

describe("cryptaRsa", () => {
  describe("commonModulusAttack", () => {
    it("recovers plaintext from common modulus", () => {
      const p = 61n;
      const q = 53n;
      const n = p * q;
      const phi = (p - 1n) * (q - 1n);
      const e1 = 17n;
      const e2 = 13n;
      const m = 42n;
      const c1 = modPow(m, e1, n);
      const c2 = modPow(m, e2, n);

      const result = commonModulusAttack(n, e1, c1, e2, c2);
      expect(result.recovered).toBe(true);
      expect(result.plaintext).toBe(m);
    });
  });

  describe("fermatFactor", () => {
    it("factors n with close p and q", () => {
      const p = 1000000007n;
      const q = 1000000009n;
      const n = p * q;
      const result = fermatFactor(n);
      expect(result.recovered).toBe(true);
      expect(result.factors).toBeDefined();
      if (result.factors) {
        expect(result.factors[0] * result.factors[1]).toBe(n);
      }
    });
  });

  describe("parseRsaPem", () => {
    it("parses hex RSA parameters", () => {
      const result = parseRsaPem("n:0xaf, e:0x10001");
      expect(result).not.toBeNull();
      expect(result!.e).toBe(65537n);
    });
  });

  describe("modPow", () => {
    it("computes modular exponentiation", () => {
      expect(modPow(2n, 3n, 5n)).toBe(3n); // 8 % 5 = 3
      expect(modPow(3n, 2n, 7n)).toBe(2n); // 9 % 7 = 2
    });
  });
});
