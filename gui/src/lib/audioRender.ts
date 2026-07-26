// 把 PCM 渲染成真实的波形/频谱图像素（RGBA），供结果面板 canvas 直接绘制。
import { hannWindow, magnitudeSpectrum } from "./fft";

const BG: [number, number, number] = [16, 18, 27];
const WAVE: [number, number, number] = [88, 196, 255];

function unitFactor(bitDepth: number) {
  return bitDepth === 8 ? 128 : 2 ** (bitDepth - 1);
}

function toUnit(sample: number, bitDepth: number) {
  return bitDepth === 8 ? (sample - 128) / 128 : sample / unitFactor(bitDepth);
}

function fillBackground(pixels: Uint8ClampedArray) {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = BG[0];
    pixels[i + 1] = BG[1];
    pixels[i + 2] = BG[2];
    pixels[i + 3] = 255;
  }
}

export function renderWaveform(samples: ArrayLike<number>, bitDepth: number, width = 800, height = 160): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  fillBackground(pixels);
  const middle = height / 2;
  const length = samples.length;
  const per = length > 0 ? length / width : 0;
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor(x * per);
    const end = Math.min(length, Math.floor((x + 1) * per));
    let min = 0;
    let max = 0;
    let seen = false;
    for (let i = start; i < end; i += 1) {
      const value = toUnit(samples[i], bitDepth);
      if (!seen) {
        min = value;
        max = value;
        seen = true;
      } else {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    const yTop = Math.round(middle - max * middle * 0.95);
    const yBottom = Math.round(middle - min * middle * 0.95);
    const lo = Math.max(0, Math.min(yTop, yBottom));
    const hi = Math.min(height - 1, Math.max(yTop, yBottom));
    for (let y = lo; y <= hi; y += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = WAVE[0];
      pixels[offset + 1] = WAVE[1];
      pixels[offset + 2] = WAVE[2];
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export interface SpectrogramResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  dominantHz?: number;
  dominantShare: number; // 主频占据的时间列比例
}

function colorFor(intensity: number, pixels: Uint8ClampedArray, offset: number) {
  // 蓝→青→黄→白 的对数热力映射
  const t = Math.max(0, Math.min(1, intensity));
  pixels[offset] = Math.round(255 * Math.min(1, Math.max(0, t * 1.6 - 0.4)));
  pixels[offset + 1] = Math.round(255 * Math.min(1, t * 1.4));
  pixels[offset + 2] = Math.round(255 * Math.min(1, Math.max(0, 1.2 - t * 1.2)));
  pixels[offset + 3] = 255;
}

export function renderSpectrogram(
  samples: ArrayLike<number>,
  sampleRate: number,
  bitDepth: number,
  fftSize: number,
  width = 800,
  height = 256,
): SpectrogramResult {
  const rows = Math.min(height, fftSize >> 1);
  const pixels = new Uint8ClampedArray(width * rows * 4);
  fillBackground(pixels);
  const window = hannWindow(fftSize);
  const hop = fftSize >> 1;
  const length = samples.length;
  const frameCount = length >= fftSize ? Math.floor((length - fftSize) / hop) + 1 : 1;
  const dominantCounts = new Map<number, number>();
  const scale = unitFactor(bitDepth);

  for (let x = 0; x < width; x += 1) {
    const frameIndex = frameCount > 1 ? Math.floor((x / (width - 1)) * (frameCount - 1)) : 0;
    const frameStart = frameIndex * hop;
    const frame = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i += 1) {
      const sampleIndex = frameStart + i;
      const value = sampleIndex < length ? samples[sampleIndex] / scale : 0;
      frame[i] = value * window[i];
    }
    const magnitude = magnitudeSpectrum(frame);
    let peakBin = 0;
    let peakValue = 0;
    for (let bin = 1; bin < magnitude.length; bin += 1) {
      if (magnitude[bin] > peakValue) {
        peakValue = magnitude[bin];
        peakBin = bin;
      }
    }
    if (peakBin > 0 && peakValue > 0.001) dominantCounts.set(peakBin, (dominantCounts.get(peakBin) ?? 0) + 1);
    for (let row = 0; row < rows; row += 1) {
      const bin = Math.min(magnitude.length - 1, Math.floor((row / rows) * magnitude.length));
      const intensity = Math.log10(1 + magnitude[bin]) / 3;
      colorFor(intensity, pixels, ((rows - 1 - row) * width + x) * 4);
    }
  }

  let dominantBin = 0;
  let dominantHits = 0;
  for (const [bin, hits] of dominantCounts) {
    if (hits > dominantHits) {
      dominantHits = hits;
      dominantBin = bin;
    }
  }
  const dominantShare = width > 0 ? dominantHits / width : 0;
  const dominantHz = dominantBin > 0 ? (dominantBin * sampleRate) / fftSize : undefined;
  return { pixels, width, height: rows, dominantHz, dominantShare };
}
