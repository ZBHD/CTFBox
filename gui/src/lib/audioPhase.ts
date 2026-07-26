// 音频相位编码检测
export interface PhaseResult {
  detected: boolean;
  deviation: number; // KL divergence from uniform
  detail: string;
}

// Compute phase difference between consecutive FFT frames
export function detectPhaseEncoding(channel: Int32Array, sampleRate: number, fftSize = 1024, hopSize?: number): PhaseResult {
  const hop = hopSize ?? fftSize / 2;
  const frames = Math.floor((channel.length - fftSize) / hop);
  if (frames < 2) return { detected: false, deviation: 0, detail: "数据不足" };

  const phaseDiffs: number[] = [];

  for (let f = 0; f < frames - 1; f++) {
    const offset1 = f * hop;
    const offset2 = (f + 1) * hop;

    // Simple phase estimation: FFT bin phase difference
    for (let bin = 1; bin < Math.min(fftSize / 2, 32); bin++) {
      const re1 = channel[offset1 + bin * 2] ?? 0;
      const im1 = channel[offset1 + bin * 2 + 1] ?? 0;
      const re2 = channel[offset2 + bin * 2] ?? 0;
      const im2 = channel[offset2 + bin * 2 + 1] ?? 0;

      const phase1 = Math.atan2(im1, re1);
      const phase2 = Math.atan2(im2, re2);
      let diff = phase2 - phase1;
      // Normalize to [-π, π]
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      phaseDiffs.push(diff);
    }
  }

  if (phaseDiffs.length < 10) return { detected: false, deviation: 0, detail: "相位数据不足" };

  // Check if phase differences cluster at specific values (deviation from uniform)
  const bins = 8;
  const histogram = new Array(bins).fill(0);
  for (const d of phaseDiffs) {
    const idx = Math.floor(((d + Math.PI) / (2 * Math.PI)) * bins);
    histogram[Math.min(bins - 1, Math.max(0, idx))] += 1;
  }

  const expected = phaseDiffs.length / bins;
  let klDiv = 0;
  for (const count of histogram) {
    if (count > 0) klDiv += (count / phaseDiffs.length) * Math.log((count / phaseDiffs.length) / (1 / bins));
  }

  const detected = klDiv > 0.5;

  return {
    detected,
    deviation: klDiv,
    detail: detected
      ? `相邻帧相位差分布不均匀 (KL散度 ${klDiv.toFixed(2)})，疑似相位编码`
      : `相位差分布均匀 (KL散度 ${klDiv.toFixed(2)})`,
  };
}
