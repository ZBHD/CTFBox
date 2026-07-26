import { describe, expect, it } from "vitest";
import { detectHomoglyphs, detectZeroWidth, extractZeroWidthPayload } from "./homoglyphDetector";

describe("homoglyphDetector", () => {
  describe("detectHomoglyphs", () => {
    it("detects mixed Latin/Cyrillic", () => {
      expect(detectHomoglyphs("Hеllo").detected).toBe(true); // Cyrillic е
    });
    it("returns false for pure Latin", () => {
      expect(detectHomoglyphs("Hello").detected).toBe(false);
    });
  });

  describe("detectZeroWidth", () => {
    it("detects zero-width space", () => {
      expect(detectZeroWidth("hel​lo").detected).toBe(true);
    });
    it("detects zero-width non-joiner", () => {
      expect(detectZeroWidth("hel‌lo").detected).toBe(true);
    });
    it("returns false for normal text", () => {
      expect(detectZeroWidth("hello").detected).toBe(false);
    });
  });

  describe("extractZeroWidthPayload", () => {
    it("extracts text from zero-width chars", () => {
      // "f" = 01100110
      // ZWSP=0, ZWNJ=1
      const payload = "​‌‌​​‌‌​"; // "01100110" = "f"
      const result = extractZeroWidthPayload(payload);
      expect(result).toBe("f");
    });
    it("returns empty for no zero-width chars", () => {
      expect(extractZeroWidthPayload("hello")).toBe("");
    });
  });
});
