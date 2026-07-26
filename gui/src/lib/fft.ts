// 通用 radix-2 Cooley-Tukey 复数 FFT（原地、迭代实现）。
// 仅依赖标准数学库，供音频频谱分析复用；长度必须为 2 的幂。

export function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) power <<= 1;
  return power;
}

function assertPowerOfTwo(n: number) {
  if (n === 0) return;
  if ((n & (n - 1)) !== 0) throw new Error("FFT 长度必须为 2 的幂");
}

// 原地正向 FFT。real/imag 长度一致且为 2 的幂。
export function fftRadix2(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n !== imag.length) throw new Error("实部与虚部长度必须一致");
  assertPowerOfTwo(n);
  if (n <= 1) return;

  // 位反转置换
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    const half = len >> 1;
    for (let start = 0; start < n; start += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const bReal = real[b] * curReal - imag[b] * curImag;
        const bImag = real[b] * curImag + imag[b] * curReal;
        real[b] = real[a] - bReal;
        imag[b] = imag[a] - bImag;
        real[a] += bReal;
        imag[a] += bImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

// 原地逆向 FFT（共轭 → 正向 → 共轭 → 归一化）。
export function ifftRadix2(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  for (let i = 0; i < n; i += 1) imag[i] = -imag[i];
  fftRadix2(real, imag);
  for (let i = 0; i < n; i += 1) {
    real[i] /= n;
    imag[i] = -imag[i] / n;
  }
}

// 对实数样本求单边幅度谱，长度不足自动补零到 2 的幂。
export function magnitudeSpectrum(samples: ArrayLike<number>): Float64Array {
  const size = nextPowerOfTwo(samples.length);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let i = 0; i < samples.length; i += 1) real[i] = samples[i];
  fftRadix2(real, imag);
  const half = size >> 1;
  const magnitude = new Float64Array(half);
  for (let i = 0; i < half; i += 1) magnitude[i] = Math.hypot(real[i], imag[i]);
  return magnitude;
}

// 汉宁窗系数（供 STFT 分帧使用）。
export function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  if (size === 1) {
    window[0] = 1;
    return window;
  }
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}
