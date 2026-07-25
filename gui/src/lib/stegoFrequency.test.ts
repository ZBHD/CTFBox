import { describe, expect, it } from "vitest";
import { analyzeFrequency, buildPixelVisuals } from "./stegoFrequency";
import type { StegoPixelSource } from "./stegoTypes";

function source(width: number, height: number, value: (x: number, y: number) => [number, number, number, number]): StegoPixelSource {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set(value(x, y), (y * width + x) * 4);
  }
  return { width, height, rgba };
}

describe("pixel and frequency analysis", () => {
  it("builds channels, transforms and all grayscale bit planes", () => {
    const visuals = buildPixelVisuals(source(2, 1, (x) => x === 0 ? [16, 32, 64, 128] : [255, 128, 0, 255]));
    expect(visuals.map((visual) => visual.label)).toEqual([
      "R 通道", "G 通道", "B 通道", "A 通道", "灰度", "反相灰度", "自动拉伸",
      "灰度位平面 0", "灰度位平面 1", "灰度位平面 2", "灰度位平面 3",
      "灰度位平面 4", "灰度位平面 5", "灰度位平面 6", "灰度位平面 7",
    ]);
    expect(Array.from(visuals[0].pixels.subarray(0, 4))).toEqual([16, 16, 16, 255]);
    expect(Array.from(visuals[3].pixels.subarray(0, 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(visuals[7].pixels.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it("places constant image energy at the centered DC bin", () => {
    const result = analyzeFrequency(source(16, 16, () => [100, 100, 100, 255]), 16);
    const center = (8 * 16 + 8) * 4;
    expect(result.visual.width).toBe(16);
    expect(result.visual.pixels[center]).toBe(255);
    expect(result.peaks).toHaveLength(0);
    expect(result.bands.low).toBeGreaterThan(0.99);
  });

  it("finds horizontal frequency offsets for vertical stripes", () => {
    const striped = source(32, 32, (x) => {
      const value = 128 + Math.round(100 * Math.sin((2 * Math.PI * 4 * x) / 32));
      return [value, value, value, 255];
    });
    const result = analyzeFrequency(striped, 32);
    expect(result.peaks.some((peak) => peak.y === 16 && peak.x !== 16)).toBe(true);
    expect(result.bands.mid).toBeGreaterThan(0);
  });

  it("resamples non-square images to a bounded FFT grid", () => {
    const result = analyzeFrequency(source(40, 10, () => [80, 90, 100, 255]), 16);
    expect(result.visual).toMatchObject({ width: 16, height: 16 });
    expect(result.visual.pixels).toHaveLength(16 * 16 * 4);
  });
});
