import { describe, expect, it } from "vitest";
import { analyzeJpegDct } from "./jpegDct";

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function segment(marker: number, payload: Uint8Array) {
  const length = payload.length + 2;
  return concat(Uint8Array.of(0xff, marker, length >>> 8, length), payload);
}

function baselineJpeg(dcCategory = 0, progressive = false, truncated = false) {
  const dcCounts = Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const acCounts = dcCounts;
  const entropy = dcCategory === 0 ? 0x3f : 0x5f;
  return concat(
    Uint8Array.of(0xff, 0xd8),
    segment(0xdb, concat(Uint8Array.of(0), new Uint8Array(64).fill(1))),
    segment(progressive ? 0xc2 : 0xc0, Uint8Array.of(8, 0, 8, 0, 8, 1, 1, 0x11, 0)),
    segment(0xc4, concat(Uint8Array.of(0), dcCounts, Uint8Array.of(dcCategory), Uint8Array.of(0x10), acCounts, Uint8Array.of(0))),
    segment(0xdd, Uint8Array.of(0, 4)),
    segment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    truncated ? new Uint8Array() : Uint8Array.of(entropy, 0xff, 0xd9),
  );
}

describe("JPEG DCT coefficient analysis", () => {
  it("decodes a baseline block and aggregates coefficient parity", () => {
    const report = analyzeJpegDct(baselineJpeg(1));
    expect(report).toMatchObject({
      supported: true,
      width: 8,
      height: 8,
      components: 1,
      blocks: 1,
      restartInterval: 4,
      zeroAcRatio: 1,
    });
    expect(report.coefficientCounts?.[0]).toBe(1);
    expect(report.oddRatios?.[0]).toBe(1);
    expect(report.oddRatios?.slice(1).every((value) => value === 0)).toBe(true);
  });

  it("returns an explicit unsupported result for progressive JPEG", () => {
    expect(analyzeJpegDct(baselineJpeg(0, true))).toMatchObject({ supported: false, reason: expect.stringContaining("渐进式") });
  });

  it("returns a bounded warning for truncated entropy data", () => {
    const report = analyzeJpegDct(baselineJpeg(0, false, true));
    expect(report.supported).toBe(true);
    expect(report.blocks).toBe(0);
    expect(report.warnings.some((warning) => warning.includes("截断"))).toBe(true);
  });

  it("rejects non-JPEG input without throwing", () => {
    expect(analyzeJpegDct(new Uint8Array(16))).toMatchObject({ supported: false, reason: "不是 JPEG 文件" });
  });
});
