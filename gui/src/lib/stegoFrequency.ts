import type { StegoPixelSource, StegoVisual } from "./stegoTypes";

export interface FrequencyPeak {
  x: number;
  y: number;
  magnitude: number;
}

export interface FrequencyResult {
  visual: StegoVisual;
  peaks: FrequencyPeak[];
  bands: { low: number; mid: number; high: number };
}

function grayAt(source: StegoPixelSource, pixel: number) {
  const offset = pixel * 4;
  return Math.round(source.rgba[offset] * 0.299 + source.rgba[offset + 1] * 0.587 + source.rgba[offset + 2] * 0.114);
}

function previewDimensions(width: number, height: number) {
  const scale = Math.min(1, 512 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function sampledChannels(source: StegoPixelSource) {
  const dimensions = previewDimensions(source.width, source.height);
  const channels = [new Uint8Array(dimensions.width * dimensions.height), new Uint8Array(dimensions.width * dimensions.height), new Uint8Array(dimensions.width * dimensions.height), new Uint8Array(dimensions.width * dimensions.height), new Uint8Array(dimensions.width * dimensions.height)];
  for (let y = 0; y < dimensions.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / dimensions.height));
    for (let x = 0; x < dimensions.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / dimensions.width));
      const sourcePixel = sourceY * source.width + sourceX;
      const targetPixel = y * dimensions.width + x;
      const offset = sourcePixel * 4;
      channels[0][targetPixel] = source.rgba[offset];
      channels[1][targetPixel] = source.rgba[offset + 1];
      channels[2][targetPixel] = source.rgba[offset + 2];
      channels[3][targetPixel] = source.rgba[offset + 3];
      channels[4][targetPixel] = grayAt(source, sourcePixel);
    }
  }
  return { ...dimensions, channels };
}

function grayVisual(id: string, label: string, width: number, height: number, values: Uint8Array | Uint8ClampedArray, detail?: string): StegoVisual {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    pixels.set([value, value, value, 255], index * 4);
  }
  return { id, label, width, height, pixels, detail };
}

export function buildPixelVisuals(source: StegoPixelSource) {
  const { width, height, channels } = sampledChannels(source);
  const [red, green, blue, alpha, gray] = channels;
  const inverted = Uint8Array.from(gray, (value) => 255 - value);
  let minimum = 255;
  let maximum = 0;
  for (const value of gray) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const stretched = Uint8Array.from(gray, (value) => maximum === minimum ? value : Math.round(((value - minimum) * 255) / (maximum - minimum)));
  const visuals = [
    grayVisual("channel-r", "R 通道", width, height, red),
    grayVisual("channel-g", "G 通道", width, height, green),
    grayVisual("channel-b", "B 通道", width, height, blue),
    grayVisual("channel-a", "A 通道", width, height, alpha),
    grayVisual("grayscale", "灰度", width, height, gray),
    grayVisual("inverted", "反相灰度", width, height, inverted),
    grayVisual("stretched", "自动拉伸", width, height, stretched, `输入范围 ${minimum}..${maximum}`),
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    visuals.push(grayVisual(`gray-bit-${bit}`, `灰度位平面 ${bit}`, width, height, Uint8Array.from(gray, (value) => ((value >>> bit) & 1) * 255)));
  }
  return visuals;
}

function fft(real: Float64Array, imaginary: Float64Array) {
  const length = real.length;
  if (length < 2 || (length & (length - 1)) !== 0) throw new Error("FFT 长度必须是 2 的幂");
  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >>> 1;
    for (; reversed & bit; bit >>>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let weightReal = 1;
      let weightImaginary = 0;
      for (let offset = 0; offset < size / 2; offset += 1) {
        const even = start + offset;
        const odd = even + size / 2;
        const oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary;
        const oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextWeightReal = weightReal * stepReal - weightImaginary * stepImaginary;
        weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal;
        weightReal = nextWeightReal;
      }
    }
  }
}

function fft2d(values: Float64Array, size: number) {
  const real = values.slice();
  const imaginary = new Float64Array(values.length);
  const lineReal = new Float64Array(size);
  const lineImaginary = new Float64Array(size);
  for (let y = 0; y < size; y += 1) {
    lineReal.set(real.subarray(y * size, (y + 1) * size));
    lineImaginary.fill(0);
    fft(lineReal, lineImaginary);
    real.set(lineReal, y * size);
    imaginary.set(lineImaginary, y * size);
  }
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      lineReal[y] = real[y * size + x];
      lineImaginary[y] = imaginary[y * size + x];
    }
    fft(lineReal, lineImaginary);
    for (let y = 0; y < size; y += 1) {
      real[y * size + x] = lineReal[y];
      imaginary[y * size + x] = lineImaginary[y];
    }
  }
  return { real, imaginary };
}

function sampleGraySquare(source: StegoPixelSource, size: number) {
  const values = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / size));
      values[y * size + x] = grayAt(source, sourceY * source.width + sourceX);
    }
  }
  return values;
}

export function analyzeFrequency(source: StegoPixelSource, requestedSize: number): FrequencyResult {
  const size = Math.max(8, Math.min(512, 2 ** Math.round(Math.log2(requestedSize))));
  const transformed = fft2d(sampleGraySquare(source, size), size);
  const magnitudes = new Float64Array(size * size);
  let maximum = 0;
  let totalEnergy = 0;
  const bandEnergy = { low: 0, mid: 0, high: 0 };
  const center = size / 2;
  const peakCandidates: FrequencyPeak[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = (x + center) % size;
      const sourceY = (y + center) % size;
      const sourceIndex = sourceY * size + sourceX;
      const magnitude = Math.hypot(transformed.real[sourceIndex], transformed.imaginary[sourceIndex]);
      const index = y * size + x;
      magnitudes[index] = magnitude;
      maximum = Math.max(maximum, magnitude);
      const energy = magnitude * magnitude;
      totalEnergy += energy;
      const radius = Math.hypot(x - center, y - center) / (Math.SQRT2 * center);
      if (radius < 0.15) bandEnergy.low += energy;
      else if (radius < 0.45) bandEnergy.mid += energy;
      else bandEnergy.high += energy;
      if (Math.hypot(x - center, y - center) > 2) peakCandidates.push({ x, y, magnitude });
    }
  }
  const logMaximum = Math.log1p(maximum);
  const display = Uint8Array.from(magnitudes, (magnitude) => logMaximum === 0 ? 0 : Math.round((Math.log1p(magnitude) * 255) / logMaximum));
  const threshold = maximum * 1e-8;
  const peaks = peakCandidates.filter((peak) => peak.magnitude > threshold).sort((left, right) => right.magnitude - left.magnitude || left.y - right.y || left.x - right.x).slice(0, 8);
  const denominator = totalEnergy || 1;
  const bands = { low: bandEnergy.low / denominator, mid: bandEnergy.mid / denominator, high: bandEnergy.high / denominator };
  const detail = `低频 ${(bands.low * 100).toFixed(2)}% · 中频 ${(bands.mid * 100).toFixed(2)}% · 高频 ${(bands.high * 100).toFixed(2)}%`;
  return { visual: grayVisual("fft", `FFT ${size} x ${size}`, size, size, display, detail), peaks, bands };
}
