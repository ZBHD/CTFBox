import { describe, expect, it } from "vitest";
import { identifyBarcode } from "./barcodeEngine";

describe("barcodeEngine", () => {
  describe("identifyBarcode", () => {
    it("identifies EAN-13", () => {
      const result = identifyBarcode("5901234123457");
      expect(result.type).toBe("EAN/UPC");
      expect(result.detected).toBe(true);
    });
    it("identifies EAN-8", () => {
      const result = identifyBarcode("12345678");
      expect(result.type).toBe("EAN-8");
      expect(result.detected).toBe(true);
    });
    it("identifies Code39", () => {
      const result = identifyBarcode("*CODE39*");
      expect(result.type).toBe("Code39");
      expect(result.detected).toBe(true);
    });
    it("returns unknown for plain text", () => {
      const result = identifyBarcode("hello");
      expect(result.detected).toBe(false);
    });
  });
});
