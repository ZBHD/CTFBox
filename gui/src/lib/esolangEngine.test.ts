import { describe, expect, it } from "vitest";
import { decodeOok, executeBrainfuck, identifyEsolang } from "./esolangEngine";

describe("esolangEngine", () => {
  describe("identifyEsolang", () => {
    it("identifies brainfuck", () => {
      expect(identifyEsolang("++++++++++[>+++++++>++++++++++").some((m) => m.type === "brainfuck")).toBe(true);
    });
    it("identifies ook", () => {
      expect(identifyEsolang("Ook. Ook? Ook!").some((m) => m.type === "ook")).toBe(true);
    });
    it("returns empty for normal text", () => {
      expect(identifyEsolang("hello world")).toEqual([]);
    });
  });

  describe("executeBrainfuck", () => {
    it("prints Hello World!", () => {
      const code = "++++++++++[>+++++++>++++++++++>+++<<<-]>++.>+.+++++++..+++.>++.<<+++++++++++++++.>.+++.------.--------.>+.";
      expect(executeBrainfuck(code)).toBe("Hello World!");
    });
    it("outputs single character", () => {
      expect(executeBrainfuck("++++++++++++++++++++++++++++++++++++++++++++++++.")).toBe("0");
    });
    it("handles empty input", () => {
      expect(executeBrainfuck("")).toBe("");
    });
  });

  describe("decodeOok", () => {
    it("decodes ook to brainfuck equivalents", () => {
      const ook = "Ook. Ook. Ook. Ook. Ook. Ook. Ook. Ook. Ook! Ook? Ook. Ook? Ook!";
      const bf = decodeOok(ook);
      expect(bf.length).toBeGreaterThan(0);
      expect("><+-.,[]".includes(bf[0])).toBe(true);
    });
  });
});
