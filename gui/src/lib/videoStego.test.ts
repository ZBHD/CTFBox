import { describe, expect, it } from "vitest";
import { analyzeVideo, identifyVideoFormat } from "./videoStego";

describe("videoStego", () => {
  describe("identifyVideoFormat", () => {
    it("identifies MP4", () => {
      const buf = new Uint8Array(12);
      buf.set([0, 0, 0, 8, 102, 116, 121, 112]); // ...ftyp
      expect(identifyVideoFormat(buf)).toContain("MP4");
    });
    it("identifies MKV", () => {
      const buf = new Uint8Array(8);
      buf.set([0x1a, 0x45, 0xdf, 0xa3]);
      expect(identifyVideoFormat(buf)).toContain("MKV");
    });
    it("identifies AVI", () => {
      const buf = new Uint8Array(8);
      buf.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
      expect(identifyVideoFormat(buf)).toContain("AVI");
    });
    it("returns unknown for random data", () => {
      expect(identifyVideoFormat(new Uint8Array(10))).toBe("未知视频格式");
    });
  });

  describe("analyzeVideo", () => {
    it("analyzes video file bytes", () => {
      const buf = new Uint8Array(20);
      buf.set([0x1a, 0x45, 0xdf, 0xa3]);
      const result = analyzeVideo(buf);
      expect(result.findings.some((f) => f.source === "视频")).toBe(true);
    });
  });
});
