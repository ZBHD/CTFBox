// DTMF 音调解码 (Goertzel 算法)
export interface DtmfResult {
  detected: boolean;
  sequence: string;
  detail: string;
}

const DTMF_FREQS = {
  row: [697, 770, 852, 941],
  col: [1209, 1336, 1477, 1633],
};

const DTMF_MAP = [
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
];

// Goertzel algorithm: detect specific frequency in sample window
function goertzel(samples: Int32Array, targetFreq: number, sampleRate: number): number {
  const n = samples.length;
  const k = Math.round(n * targetFreq / sampleRate);
  const omega = (2.0 * Math.PI * k) / n;
  const coeff = 2.0 * Math.cos(omega);

  let s0 = 0;
  let s1 = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i] + coeff * s0 - s1;
    s1 = s0;
    s0 = s;
  }
  return Math.sqrt(s0 * s0 + s1 * s1 - coeff * s0 * s1);
}

export function detectDtmf(channel: Int32Array, sampleRate: number, windowMs = 40): DtmfResult {
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  if (windowSamples < 64 || channel.length < windowSamples) {
    return { detected: false, sequence: "", detail: `采样数据不足 (需至少 ${windowSamples} 样本)` };
  }

  const sequence: string[] = [];
  let windows = 0;

  for (let offset = 0; offset + windowSamples <= channel.length; offset += windowSamples / 2) {
    const window = channel.slice(offset, offset + windowSamples);
    windows += 1;

    let maxRow = -1;
    let maxRowMag = 0;
    for (let r = 0; r < DTMF_FREQS.row.length; r++) {
      const mag = goertzel(window, DTMF_FREQS.row[r], sampleRate);
      if (mag > maxRowMag) { maxRowMag = mag; maxRow = r; }
    }

    let maxCol = -1;
    let maxColMag = 0;
    for (let c = 0; c < DTMF_FREQS.col.length; c++) {
      const mag = goertzel(window, DTMF_FREQS.col[c], sampleRate);
      if (mag > maxColMag) { maxColMag = mag; maxCol = c; }
    }

    // Threshold: both row and col must be significantly above noise
    const avgMag = (maxRowMag + maxColMag) / 2;
    const energy = window.reduce((sum, s) => sum + Math.abs(s), 0) / window.length;

    if (avgMag > energy * 2 && maxRow >= 0 && maxCol >= 0) {
      const digit = DTMF_MAP[maxRow][maxCol];
      if (sequence.length === 0 || sequence[sequence.length - 1] !== digit) {
        sequence.push(digit);
      }
    }
  }

  if (sequence.length >= 3) {
    return {
      detected: true,
      sequence: sequence.join(""),
      detail: `检测到 ${sequence.length} 个 DTMF 码 (${sequence.join(" ")})，窗口 ${windows} 个`,
    };
  }

  return { detected: false, sequence: "", detail: `分析 ${windows} 个窗口，未检测到足够的 DTMF 信号` };
}
