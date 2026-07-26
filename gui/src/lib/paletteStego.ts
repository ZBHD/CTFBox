// 调色板隐写分析：PNG/GIF 调色板排序/相邻色 LSB/索引位流
import { detectFlags } from "./flagDetector";

export interface PaletteResult {
  findings: PaletteFinding[];
  candidates: PaletteCandidate[];
}

export interface PaletteFinding {
  id: string;
  severity: "high" | "suspicious" | "info";
  source: string;
  title: string;
  detail: string;
}

export interface PaletteCandidate {
  id: string;
  source: string;
  value: string;
  detail: string;
  flags: string[];
}

// Check if palette is sorted by luminance (EzStego signature)
function paletteLuminance(rgb: Uint8Array): number[] {
  const lum: number[] = [];
  for (let i = 0; i < rgb.length; i += 3) {
    lum.push(0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]);
  }
  return lum;
}

function isLuminanceSorted(luminances: number[]): boolean {
  if (luminances.length < 4) return false;
  let increasing = 0;
  let decreasing = 0;
  for (let i = 1; i < luminances.length; i++) {
    if (luminances[i] > luminances[i - 1]) increasing += 1;
    else if (luminances[i] < luminances[i - 1]) decreasing += 1;
  }
  const total = luminances.length - 1;
  return increasing / total > 0.9 || decreasing / total > 0.9;
}

export function analyzePalette(paletteRgb: Uint8Array, paletteIndices: Uint8Array | undefined, prefixes: readonly string[], caseSensitive: boolean): PaletteResult {
  const findings: PaletteFinding[] = [];
  const candidates: PaletteCandidate[] = [];
  const colorCount = paletteRgb.length / 3;

  if (colorCount < 2) return { findings, candidates };

  // 1. Check luminance ordering (EzStego)
  const lum = paletteLuminance(paletteRgb);
  if (isLuminanceSorted(lum)) {
    findings.push({
      id: "palette-sorted", severity: "suspicious", source: "调色板", title: "调色板按亮度排序",
      detail: `${colorCount} 色的调色板按亮度严格排列，疑似 EzStego 等工具嵌入`,
    });
  }

  // 2. Adjacent color LSB analysis
  const bits: number[] = [];
  for (let i = 0; i + 3 < paletteRgb.length; i += 3) {
    const next = i + 3;
    if (next < paletteRgb.length) {
      bits.push(paletteRgb[i] & 1);     // R LSB
      bits.push(paletteRgb[i + 1] & 1); // G LSB
      bits.push(paletteRgb[i + 2] & 1); // B LSB
    }
  }

  if (bits.length >= 8) {
    const bytes = bitsToBytes(bits);
    const text = bytesToText(bytes);
    if (text) {
      const flags = detectFlags(text, prefixes, caseSensitive).map((h) => h.text);
      if (flags.length > 0) {
        candidates.push({ id: "pal-adj-lsb", source: "调色板相邻色 LSB", value: text, detail: "相邻调色板颜色的 RGB LSB 重组", flags });
      }
    }
  }

  // 3. Palette index bit stream
  if (paletteIndices && paletteIndices.length >= 8) {
    const indexBits: number[] = [];
    for (const idx of paletteIndices) {
      for (let bit = 0; bit < 8; bit++) {
        indexBits.push((idx >> bit) & 1);
      }
    }
    const indexBytes = bitsToBytes(indexBits);
    const indexText = bytesToText(indexBytes);
    if (indexText) {
      const flags = detectFlags(indexText, prefixes, caseSensitive).map((h) => h.text);
      if (flags.length > 0) {
        candidates.push({ id: "pal-idx-stream", source: "调色板索引位流", value: indexText, detail: "像素索引的 LSB→MSB 位流重组", flags });
      }
    }

    // 4. LSB of indices
    const idxLsbBits: number[] = [];
    for (const idx of paletteIndices) idxLsbBits.push(idx & 1);
    if (idxLsbBits.length >= 8) {
      const lsbBytes = bitsToBytes(idxLsbBits);
      const lsbText = bytesToText(lsbBytes);
      if (lsbText) {
        const flags = detectFlags(lsbText, prefixes, caseSensitive).map((h) => h.text);
        if (flags.length > 0) {
          candidates.push({ id: "pal-idx-lsb", source: "调色板索引 LSB", value: lsbText, detail: "每个像素索引的最低位重组", flags });
        }
      }
    }
  }

  return { findings, candidates };
}

function bitsToBytes(bits: number[]): Uint8Array {
  const byteLen = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    bytes[i] = b;
  }
  return bytes;
}

function bytesToText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}
