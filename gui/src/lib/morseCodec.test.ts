import { describe, expect, it } from "vitest";
import { decodeMorse, detectMorse, isMorse } from "./morseCodec";

describe("morseCodec", () => {
  describe("isMorse", () => {
    it("identifies pure morse with / separator", () => {
      expect(isMorse("...././.-../.-../---")).toBe(true);
    });
    it("identifies morse with space separator", () => {
      expect(isMorse(".... . .-.. .-.. ---")).toBe(true);
    });
    it("rejects normal text", () => {
      expect(isMorse("hello world")).toBe(false);
    });
    it("rejects empty input", () => {
      expect(isMorse("")).toBe(false);
    });
  });

  describe("decodeMorse", () => {
    it("decodes standard morse with / separator", () => {
      expect(decodeMorse("...././.-../.-../---")).toBe("HELLO");
    });
    it("decodes with space separator", () => {
      expect(decodeMorse(".... . .-.. .-.. ---", " ")).toBe("HELLO");
    });
    it("decodes flag format", () => {
      const morse = "..-./.-../.-/--./-.--./--/-----/.-./..././..--.-/-.-./-----/-.././..--.-/--/.-/.../-/./.-./-.--.-";
      expect(decodeMorse(morse)).toBe("FLAG{M0RSE_C0DE_MASTER}");
    });
  });

  describe("detectMorse", () => {
    it("detects and decodes morse with /", () => {
      const result = detectMorse("...././.-../.-../---", ["flag"], false);
      expect(result.detected).toBe(true);
      expect(result.decoded).toBe("HELLO");
    });
    it("detects morse with space separator", () => {
      const result = detectMorse(".... . .-.. .-.. ---", [], false);
      expect(result.detected).toBe(true);
    });
  });
});
