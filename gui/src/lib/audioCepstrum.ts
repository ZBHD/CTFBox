// 音频倒谱分析：回声隐藏检测
export interface CepstrumResult {
  detected: boolean;
  echoDelay?: number; // samples
  echoStrength?: number;
  detail: string;
}

// Real cepstrum: IFFT(log|FFT(x)|)
export function detectEcho(channel: Int32Array, sampleRate: number, fftSize = 1024): CepstrumResult {
  if (channel.length < fftSize * 2) {
    return { detected: false, detail: "数据不足" };
  }

  // Use middle segment for analysis
  const start = Math.floor(channel.length / 3);
  const segment = channel.slice(start, start + fftSize);
  if (segment.length < fftSize) return { detected: false, detail: "数据不足" };

  // Real FFT (simplified: use power spectrum via autocorrelation)
  const windowed = segment.map((v, i) => v * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (fftSize - 1))));
  const powerSpectrum = new Float64Array(fftSize / 2);

  // DFT for power spectrum
  for (let k = 0; k < fftSize / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < fftSize; n++) {
      const angle = -2 * Math.PI * k * n / fftSize;
      re += windowed[n] * Math.cos(angle);
      im += windowed[n] * Math.sin(angle);
    }
    powerSpectrum[k] = Math.log(Math.max(re * re + im * im, 1e-10));
  }

  // IFFT of log spectrum → cepstrum
  const cepstrum = new Float64Array(fftSize / 2);
  for (let n = 0; n < fftSize / 2; n++) {
    let sum = 0;
    for (let k = 0; k < fftSize / 2; k++) {
      sum += powerSpectrum[k] * Math.cos(2 * Math.PI * k * n / (fftSize / 2));
    }
    cepstrum[n] = sum / fftSize;
  }

  // Find echo peak: look for local maxima in cepstrum (skip first few samples = DC)
  let maxPeak = 0;
  let peakPos = 0;
  const minDelaySamples = Math.floor(sampleRate * 0.0005); // 0.5ms min
  const maxDelaySamples = Math.floor(sampleRate * 0.005);  // 5ms max

  for (let i = minDelaySamples; i < Math.min(maxDelaySamples, fftSize / 4); i++) {
    if (i >= cepstrum.length) break;
    if (cepstrum[i] > maxPeak && cepstrum[i] > cepstrum[i - 1] && cepstrum[i] > cepstrum[i + 1]) {
      maxPeak = cepstrum[i];
      peakPos = i;
    }
  }

  // Threshold: echo peak must be significant
  const baseline = cepstrum.slice(10, 50).reduce((a, b) => a + b, 0) / 40;
  const detected = maxPeak > baseline * 3 && peakPos > 0;

  return {
    detected,
    echoDelay: detected ? peakPos : undefined,
    echoStrength: detected ? maxPeak / baseline : undefined,
    detail: detected
      ? `检测到回声，延迟 ${(peakPos * 1000 / sampleRate).toFixed(2)}ms，强度比 ${(maxPeak / baseline).toFixed(1)}x`
      : "未检测到明显回声信号",
  };
}
