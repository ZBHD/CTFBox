import { describe, expect, it } from "vitest";
import { convertFullwidthToHalfwidth, detectFullwidth, detectPinyin } from "./cjkCodec";

describe("cjkCodec", () => {
  describe("detectFullwidth", () => {
    it("detects fullwidth characters", () => {
      expect(detectFullwidth("Ｈｅｌｌｏ").detected).toBe(true);
    });
    it("returns false for normal text", () => {
      expect(detectFullwidth("Hello").detected).toBe(false);
    });
  });

  describe("convertFullwidthToHalfwidth", () => {
    it("converts fullwidth alphabet", () => {
      expect(convertFullwidthToHalfwidth("Ｈｅｌｌｏ")).toBe("Hello");
    });
    it("converts fullwidth digits", () => {
      expect(convertFullwidthToHalfwidth("１２３")).toBe("123");
    });
    it("preserves CJK characters", () => {
      expect(convertFullwidthToHalfwidth("你好")).toBe("你好");
    });
  });

  describe("detectPinyin", () => {
    it("detects pinyin text", () => {
      const result = detectPinyin("ni hao shi jie");
      expect(result.detected).toBe(true);
    });
    it("returns false for English", () => {
      const result = detectPinyin("hello world");
      expect(result.detected).toBe(false);
    });
  });
});
