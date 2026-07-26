import { describe, expect, it } from "vitest";
import { fftRadix2, hannWindow, ifftRadix2, magnitudeSpectrum, nextPowerOfTwo } from "./fft";

describe("fft", () => {
  it("rounds up to the next power of two", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(1024)).toBe(1024);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });

  it("rejects non power-of-two lengths", () => {
    expect(() => fftRadix2(new Float64Array(3), new Float64Array(3))).toThrow("2 的幂");
  });

  it("places a pure tone at the expected magnitude bin", () => {
    const size = 64;
    const bin = 5;
    const samples = new Float64Array(size);
    for (let i = 0; i < size; i += 1) samples[i] = Math.cos((2 * Math.PI * bin * i) / size);
    const magnitude = magnitudeSpectrum(samples);
    let peak = 0;
    for (let i = 1; i < magnitude.length; i += 1) if (magnitude[i] > magnitude[peak]) peak = i;
    expect(peak).toBe(bin);
    expect(magnitude[bin]).toBeGreaterThan(size / 4);
  });

  it("recovers the input through a forward/inverse round trip", () => {
    const size = 32;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let i = 0; i < size; i += 1) real[i] = Math.sin(i) + (i % 3);
    const original = Array.from(real);
    fftRadix2(real, imag);
    ifftRadix2(real, imag);
    for (let i = 0; i < size; i += 1) {
      expect(real[i]).toBeCloseTo(original[i], 6);
      expect(imag[i]).toBeCloseTo(0, 6);
    }
  });

  it("builds a symmetric hann window that peaks in the middle", () => {
    const window = hannWindow(8);
    expect(window[0]).toBeCloseTo(0, 6);
    expect(window[7]).toBeCloseTo(0, 6);
    expect(window[4]).toBeGreaterThan(window[1]);
  });
});
