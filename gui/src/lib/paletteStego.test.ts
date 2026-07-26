import { describe, expect, it } from "vitest";
import { analyzePalette } from "./paletteStego";

describe("paletteStego", () => {
  it("detects luminance-sorted palette", () => {
    // Create a 6-color palette sorted by luminance
    const palette = new Uint8Array(18);
    palette.set([0, 0, 0], 0);
    palette.set([50, 50, 50], 3);
    palette.set([100, 100, 100], 6);
    palette.set([150, 150, 150], 9);
    palette.set([200, 200, 200], 12);
    palette.set([255, 255, 255], 15);
    const result = analyzePalette(palette, undefined, ["flag"], false);
    expect(result.findings.some((f) => f.source === "调色板" && f.title.includes("亮度"))).toBe(true);
  });

  it("returns empty for small palette", () => {
    const result = analyzePalette(new Uint8Array(3), undefined, ["flag"], false);
    expect(result.findings.length).toBe(0);
  });

  it("runs index analysis without throwing", () => {
    const indices = new Uint8Array(16);
    const palette = new Uint8Array(8 * 3);
    for (let i = 0; i < 8; i++) palette.set([i * 30, i * 25, i * 20], i * 3);
    const result = analyzePalette(palette, indices, ["flag"], false);
    // Analysis runs without errors — outputs may be empty if no flags found
    expect(result).toBeDefined();
  });
});
