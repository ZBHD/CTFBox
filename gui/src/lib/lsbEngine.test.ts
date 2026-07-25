import { describe, expect, it } from "vitest";
import type { LsbExtractionParameters, LsbImageSource, LsbScan } from "./lsbTypes";
import {
  DEFAULT_LSB_PARAMETERS,
  extractLsb,
  scanPixelIndexes,
  validateLsbParameters,
} from "./lsbEngine";

function sourceFromPixels(pixels: Array<[number, number, number, number]>): LsbImageSource {
  return {
    width: pixels.length,
    height: 1,
    rgba: Uint8Array.from(pixels.flat()),
  };
}

function sourceFromRBits(bits: number[]): LsbImageSource {
  return sourceFromPixels(bits.map((bit) => [bit, 0, 0, 255]));
}

function bitsForBytes(bytes: number[], packing: "msb-first" | "lsb-first" = "msb-first") {
  return bytes.flatMap((byte) => Array.from({ length: 8 }, (_, index) =>
    packing === "msb-first" ? (byte >> (7 - index)) & 1 : (byte >> index) & 1,
  ));
}

function parameters(overrides: Partial<LsbExtractionParameters> = {}): LsbExtractionParameters {
  return {
    ...DEFAULT_LSB_PARAMETERS,
    ...overrides,
    scan: { ...DEFAULT_LSB_PARAMETERS.scan, ...overrides.scan },
    sources: overrides.sources ?? [{ channel: "R", bit: 0 }],
  };
}

describe("LSB scan order", () => {
  const cases: Array<[string, LsbScan, number[]]> = [
    ["rows left-to-right top-to-bottom", { major: "row", x: "left-to-right", y: "top-to-bottom", serpentine: false, reversePixels: false }, [0, 1, 2, 3]],
    ["rows right-to-left top-to-bottom", { major: "row", x: "right-to-left", y: "top-to-bottom", serpentine: false, reversePixels: false }, [1, 0, 3, 2]],
    ["rows left-to-right bottom-to-top", { major: "row", x: "left-to-right", y: "bottom-to-top", serpentine: false, reversePixels: false }, [2, 3, 0, 1]],
    ["rows right-to-left bottom-to-top", { major: "row", x: "right-to-left", y: "bottom-to-top", serpentine: false, reversePixels: false }, [3, 2, 1, 0]],
    ["columns top-to-bottom left-to-right", { major: "column", x: "left-to-right", y: "top-to-bottom", serpentine: false, reversePixels: false }, [0, 2, 1, 3]],
    ["columns bottom-to-top left-to-right", { major: "column", x: "left-to-right", y: "bottom-to-top", serpentine: false, reversePixels: false }, [2, 0, 3, 1]],
    ["columns top-to-bottom right-to-left", { major: "column", x: "right-to-left", y: "top-to-bottom", serpentine: false, reversePixels: false }, [1, 3, 0, 2]],
    ["columns bottom-to-top right-to-left", { major: "column", x: "right-to-left", y: "bottom-to-top", serpentine: false, reversePixels: false }, [3, 1, 2, 0]],
  ];

  it.each(cases)("scans %s", (_, scan, expected) => {
    expect(scanPixelIndexes(2, 2, scan)).toEqual(expected);
  });

  it("supports serpentine and whole-sequence reversal", () => {
    expect(scanPixelIndexes(2, 2, { major: "row", x: "left-to-right", y: "top-to-bottom", serpentine: true, reversePixels: false })).toEqual([0, 1, 3, 2]);
    expect(scanPixelIndexes(2, 2, { major: "column", x: "left-to-right", y: "top-to-bottom", serpentine: true, reversePixels: false })).toEqual([0, 2, 3, 1]);
    expect(scanPixelIndexes(2, 2, { major: "row", x: "left-to-right", y: "top-to-bottom", serpentine: false, reversePixels: true })).toEqual([3, 2, 1, 0]);
  });
});

describe("LSB extraction", () => {
  it("packs a single channel MSB-first", () => {
    expect(extractLsb(sourceFromRBits(bitsForBytes([0x41])), parameters())).toEqual(Uint8Array.of(0x41));
  });

  it("reads ordered mixed channel bits per pixel", () => {
    const source = sourceFromPixels([
      [0b00000100, 0, 0, 255],
      [0b00000100, 0, 0, 255],
    ]);
    const sources = [
      { channel: "R" as const, bit: 4 as const },
      { channel: "R" as const, bit: 2 as const },
      { channel: "R" as const, bit: 1 as const },
      { channel: "G" as const, bit: 4 as const },
      { channel: "G" as const, bit: 2 as const },
      { channel: "G" as const, bit: 1 as const },
    ];

    expect(extractLsb(source, parameters({ sources }))).toEqual(Uint8Array.of(0x41));
  });

  it("supports channel-block layout", () => {
    const source = sourceFromPixels([
      [0, 0, 0, 255],
      [1, 0, 0, 255],
      [0, 0, 0, 255],
      [0, 1, 0, 255],
    ]);
    expect(extractLsb(source, parameters({
      sources: [{ channel: "R", bit: 0 }, { channel: "G", bit: 0 }],
      layout: "channel-block",
    }))).toEqual(Uint8Array.of(0x41));
  });

  it("packs bytes LSB-first", () => {
    const bits = bitsForBytes([0x41], "lsb-first");
    expect(extractLsb(sourceFromRBits(bits), parameters({ packing: "lsb-first" }))).toEqual(Uint8Array.of(0x41));
  });

  it("applies bit transforms before byte transforms", () => {
    const payload = bitsForBytes([0x00, 0x42, 0x41]).map((bit) => bit ^ 1);
    expect(extractLsb(sourceFromRBits([1, ...payload]), parameters({
      bitOffset: 1,
      invertBits: true,
      byteOffset: 1,
      reverseBytes: true,
    }))).toEqual(Uint8Array.from([0x41, 0x42]));
  });

  it("stops after a UTF-8 terminator and enforces byte limits", () => {
    const input = new TextEncoder().encode("A}trailing");
    expect(new TextDecoder().decode(extractLsb(sourceFromRBits(bitsForBytes([...input])), parameters({ terminator: "}" })))).toBe("A}");
    expect(extractLsb(sourceFromRBits(bitsForBytes([1, 2, 3])), parameters({ byteLimit: 2 }))).toEqual(Uint8Array.from([1, 2]));
  });

  it("reads palette index bits", () => {
    const source: LsbImageSource = {
      width: 8,
      height: 1,
      rgba: new Uint8Array(8 * 4),
      paletteIndices: Uint8Array.from(bitsForBytes([0x41])),
    };
    expect(extractLsb(source, parameters({
      sourceKind: "palette-index",
      sources: [{ channel: "I", bit: 0 }],
    }))).toEqual(Uint8Array.of(0x41));
  });

  it("drops a trailing partial byte", () => {
    expect(extractLsb(sourceFromRBits([0, 1, 0, 0, 0, 0, 0]), parameters())).toEqual(new Uint8Array());
  });
});

describe("LSB parameter validation", () => {
  it("reports malformed sources and bounds", () => {
    const source = sourceFromRBits([0, 1, 0, 0, 0, 0, 0, 1]);
    expect(validateLsbParameters(source, parameters({ sources: [] }))).toContain("至少选择一个数据源");
    expect(validateLsbParameters(source, parameters({ sources: [{ channel: "I", bit: 0 }] }))).toContain("索引通道仅适用于 PNG 调色板数据源");
    expect(validateLsbParameters(source, parameters({ sourceKind: "palette-index", sources: [{ channel: "I", bit: 0 }] }))).toContain("当前图片没有可用的调色板索引");
    expect(validateLsbParameters(source, parameters({ byteOffset: -1 }))).toContain("字节偏移必须是非负整数");
    expect(validateLsbParameters(source, parameters({ byteLimit: 0 }))).toContain("输出上限必须是正整数");
  });
});
