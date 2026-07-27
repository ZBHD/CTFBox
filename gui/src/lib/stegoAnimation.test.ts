// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import UPNG from "upng-js";
import { analyzeAnimationFrames } from "./stegoAnimation";

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("animation frame analysis", () => {
  it("finds changed APNG frames after their positions and pixels vary", () => {
    const width = 24;
    const height = 16;
    const makeFrame = (variant = 0, jitter = 0) => {
      const pixels = new Uint8Array(width * height * 4).fill(255);
      const jitterOffset = ((jitter % width) + (Math.floor(jitter / width) % height) * width) * 4;
      pixels[jitterOffset] = 0;
      pixels[jitterOffset + 1] = 0;
      pixels[jitterOffset + 2] = 0;
      if (variant > 0) {
        const left = variant * 2;
        const top = variant;
        for (let y = top; y < top + variant + 2; y += 1) {
          for (let x = left; x < left + variant + 3; x += 1) {
            const offset = (y * width + x) * 4;
            pixels[offset] = 0;
            pixels[offset + 1] = 0;
            pixels[offset + 2] = 0;
          }
        }
      }
      return pixels.buffer;
    };
    const cases = [
      [1, 6, 10],
      [0, 4, 8],
    ];

    for (const positions of cases) {
      const frames = Array.from({ length: 12 }, (_, index) => makeFrame(0, index));
      positions.forEach((position, index) => {
        frames[position] = makeFrame(index + 1, position);
      });
      const encoded = new Uint8Array(UPNG.encode(frames, width, height, 0, Array(12).fill(80)));

      const result = analyzeAnimationFrames(encoded);

      expect(result.files.map((file) => file.offset)).toEqual(positions);
    }
  });

  it("uses a robust outlier score when an animation has no repeated baseline", () => {
    const width = 32;
    const height = 16;
    const frames = Array.from({ length: 15 }, (_, frameIndex) => {
      const pixels = new Uint8Array(width * height * 4).fill(255);
      const count = frameIndex === 9 ? 120 : frameIndex + 1;
      for (let pixel = 0; pixel < count; pixel += 1) {
        const offset = pixel * 4;
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
      }
      return pixels.buffer;
    });
    const encoded = new Uint8Array(UPNG.encode(frames, width, height, 0, Array(15).fill(80)));

    const result = analyzeAnimationFrames(encoded);

    expect(result.files.map((file) => file.offset)).toEqual([9]);
  });

  corpusIt("selects and exports the verified hidden GIF frames from misc37", () => {
    const result = analyzeAnimationFrames(new Uint8Array(readFileSync(`${corpus}\\misc37.gif`)));

    expect(result.files.map((file) => file.name)).toEqual([
      "gif-frame-009.png",
      "gif-frame-014.png",
      "gif-frame-021.png",
      "gif-frame-031.png",
      "gif-frame-034.png",
    ]);
    const visualIds = result.visuals.map((visual) => visual.id);
    expect(visualIds).toContain("gif-frame-009");
    expect(visualIds).toContain("gif-frame-014");
    expect(visualIds).toContain("gif-frame-021");
    expect(visualIds).toContain("gif-frame-031");
    expect(visualIds).toContain("gif-frame-034");
    expect(visualIds).toContain("animation-stitch-all");
    // Verify stitch visual has correct dimensions
    const stitch = result.visuals.find((v) => v.id === "animation-stitch-all")!;
    expect(stitch.height).toBeGreaterThan(1);
    expect(stitch.pixels.length).toBe(stitch.width * stitch.height * 4);
  });

  corpusIt("selects and exports the verified hidden APNG frames from misc38", () => {
    const result = analyzeAnimationFrames(new Uint8Array(readFileSync(`${corpus}\\misc38.png`)));

    expect(result.files.map((file) => file.name)).toEqual([
      "apng-frame-009.png",
      "apng-frame-017.png",
      "apng-frame-036.png",
      "apng-frame-040.png",
    ]);
    expect(result.files.every((file) => Array.from(file.bytes.slice(0, 8)).join(",") === "137,80,78,71,13,10,26,10")).toBe(true);
  });

  it("returns no frames for static or unknown data", () => {
    expect(analyzeAnimationFrames(new Uint8Array(64))).toEqual({ visuals: [], files: [], findings: [] });
  });
});
