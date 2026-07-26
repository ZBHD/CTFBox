import { describe, expect, it } from "vitest";
import { Mt19937 } from "./cryptaPrng";

describe("cryptaPrng", () => {
  describe("Mt19937", () => {
    it("generates reproducible sequence", () => {
      const mt1 = new Mt19937(42);
      const mt2 = new Mt19937(42);
      for (let i = 0; i < 10; i++) expect(mt1.next()).toBe(mt2.next());
    });

    it("clones state from 624 outputs", () => {
      const original = new Mt19937(12345);
      const outputs: number[] = [];
      for (let i = 0; i < 624; i++) outputs.push(original.next());
      const cloned = Mt19937.fromOutputs(outputs);
      expect(cloned).not.toBeNull();
      for (let i = 0; i < 10; i++) expect(cloned!.next()).toBe(original.next());
    });

    it("fromOutputs returns null for insufficient outputs", () => {
      expect(Mt19937.fromOutputs([1, 2, 3])).toBeNull();
    });
  });
});
