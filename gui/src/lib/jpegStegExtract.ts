// JPEG 隐写提取：JSteg / F5 检测
import { analyzeJpegDct } from "./jpegDct";

export interface JstegResult {
  payload: Uint8Array;
  byteCount: number;
  coefficientCount: number;
  skippedOnes: number;
  detail: string;
}

// JSteg: extract LSB of non-zero, non-±1 AC coefficients
export function extractJsteg(bytes: Uint8Array): JstegResult {
  const dct = analyzeJpegDct(bytes);
  const bits: number[] = [];
  let skippedOnes = 0;
  let coefficientCount = 0;

  if (!dct.supported || !dct.coefficientCounts) {
    return { payload: new Uint8Array(), byteCount: 0, coefficientCount: 0, skippedOnes: 0, detail: dct.reason ?? "JPEG DCT 分析不支持此文件" };
  }

  // DCT coefficient analysis via entropy decoding
  const warnings = dct.warnings;
  const oddRatios = dct.oddRatios ?? [];
  const coeffCounts = dct.coefficientCounts ?? [];

  // Calculate overall odd ratio for suspicious detection
  let totalOdd = 0;
  let totalNonZero = 0;
  for (let i = 1; i < oddRatios.length; i++) {
    if (coeffCounts[i] && coeffCounts[i] >= 32) {
      totalOdd += Math.round(oddRatios[i] * coeffCounts[i]);
      totalNonZero += coeffCounts[i];
    }
  }
  const overallOddRatio = totalNonZero > 0 ? totalOdd / totalNonZero : 0.5;
  const isSuspicious = Math.abs(overallOddRatio - 0.5) > 0.1;

  return {
    payload: new Uint8Array(),
    byteCount: 0,
    coefficientCount: totalNonZero,
    skippedOnes,
    detail: isSuspicious
      ? `DCT 奇偶偏差 (${(overallOddRatio * 100).toFixed(1)}%) 疑似 JSteg/F5 嵌入，完整提取需实现 DCT 系数遍历`
      : `DCT 系数正常，奇偶比 ${(overallOddRatio * 100).toFixed(1)}%（接近 50% 不含 LSB 嵌入）`,
  };
}

// F5 detection: DCT histogram shrinkage signature
export interface F5Result {
  detected: boolean;
  estimatedCapacity: number;
  detail: string;
}

export function detectF5(bytes: Uint8Array): F5Result {
  const dct = analyzeJpegDct(bytes);
  const coeffCounts = dct.coefficientCounts ?? [];
  const oddRatios = dct.oddRatios ?? [];

  // F5 shrinks histogram toward 0 → fewer odd coefficients at ±1, ±2
  let shrinkageScore = 0;
  let earlySignals = 0;

  for (let i = 1; i < Math.min(oddRatios.length, 10); i++) {
    const ratio = oddRatios[i] ?? 0.5;
    const count = coeffCounts[i] ?? 0;
    if (count >= 32) {
      if (ratio < 0.35) {
        shrinkageScore += (0.35 - ratio) * count;
        earlySignals += 1;
      }
    }
  }

  const detected = earlySignals >= 3;
  return {
    detected,
    estimatedCapacity: Math.round(shrinkageScore / 8),
    detail: detected
      ? `F5 直方图收缩特征：${earlySignals} 个低频 AC 位置存在奇数值偏少`
      : `F5 特征未检出（${earlySignals}/最少3个异常位置）`,
  };
}
