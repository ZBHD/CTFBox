import { assessFlagCandidate, detectFlags } from "./flagDetector";
import { decodeMarkerHighlightText } from "./stegoDotMatrix";
import type { StegoChannelCandidate, StegoFinding, StegoVisual } from "./stegoTypes";

export interface ByteRecipeOptions {
  maximumBytes?: number;
  maximumStride?: number;
  maximumCandidates?: number;
}

export interface ByteRecipeResult {
  candidates: StegoChannelCandidate[];
  visuals: StegoVisual[];
  findings: StegoFinding[];
}

function strideFlags(
  bytes: Uint8Array,
  prefixes: readonly string[],
  caseSensitive: boolean,
  maximumStride: number,
  maximumCandidates: number,
) {
  const candidates: StegoChannelCandidate[] = [];
  const completeHexCandidates: Array<{ candidate: StegoChannelCandidate; stride: number; offset: number; key: string }> = [];
  for (let stride = 2; stride <= maximumStride && candidates.length < maximumCandidates; stride += 1) {
    for (let residue = 0; residue < stride && candidates.length < maximumCandidates; residue += 1) {
      const selected = new Uint8Array(Math.ceil(Math.max(0, bytes.length - residue) / stride));
      let output = 0;
      for (let offset = residue; offset < bytes.length; offset += stride) selected[output++] = bytes[offset];
      const decoded = new TextDecoder("iso-8859-1", { fatal: false }).decode(selected.subarray(0, output));
      for (const hit of detectFlags(decoded, prefixes, caseSensitive)) {
        if (candidates.some((candidate) => candidate.value === hit.text && candidate.label === `步长 ${stride}，余数 ${residue}`)) continue;
        const decodedOffset = decoded.indexOf(hit.text);
        const originalOffset = decodedOffset < 0 ? residue : residue + decodedOffset * stride;
        const assessment = assessFlagCandidate(hit.text);
        const candidate: StegoChannelCandidate = {
          id: `byte-stride-${stride}-${residue}-${candidates.length}`,
          source: "字节步长配方",
          label: `步长 ${stride}，余数 ${residue}`,
          value: hit.text,
          confidence: assessment.confidence === "high" ? "high" : "candidate",
          detail: `从原始偏移 0x${originalOffset.toString(16)} 开始，每 ${stride} 字节取一个值`,
          flags: [hit.text],
        };
        candidates.push(candidate);
        const complete = hit.text.match(/^([A-Za-z][A-Za-z0-9_-]{1,31})\{([0-9a-fA-F]{32})\}$/);
        if (complete) completeHexCandidates.push({
          candidate,
          stride,
          offset: originalOffset,
          key: `${stride}:${caseSensitive ? complete[1] : complete[1].toLowerCase()}:${complete[2].length}`,
        });
        if (candidates.length >= maximumCandidates) break;
      }
    }
  }
  const groups = new Map<string, Array<(typeof completeHexCandidates)[number]>>();
  for (const entry of completeHexCandidates) groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const preferred = group.reduce((latest, entry) => entry.offset > latest.offset ? entry : latest);
    for (const entry of group) entry.candidate.confidence = entry === preferred ? "high" : "candidate";
  }
  return candidates;
}

function matrixPixels(bytes: Uint8Array, start: number, rows: number, columns: number, marker: readonly [number, number]) {
  const pixels = new Uint8ClampedArray(columns * rows * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offset = start + (row * columns + column) * 2;
      const marked = bytes[offset] === marker[0] && bytes[offset + 1] === marker[1];
      const pixel = (row * columns + column) * 4;
      const value = marked ? 0 : 255;
      pixels[pixel] = value;
      pixels[pixel + 1] = value;
      pixels[pixel + 2] = value;
      pixels[pixel + 3] = 255;
    }
  }
  return pixels;
}

function transpose(pixels: Uint8ClampedArray, width: number, height: number, inverted: boolean) {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = (x * height + y) * 4;
      const value = inverted ? 255 - pixels[source] : pixels[source];
      result[target] = value;
      result[target + 1] = value;
      result[target + 2] = value;
      result[target + 3] = 255;
    }
  }
  return result;
}

function invertPixels(pixels: Uint8ClampedArray) {
  const result = pixels.slice();
  for (let offset = 0; offset < result.length; offset += 4) {
    result[offset] = 255 - result[offset];
    result[offset + 1] = 255 - result[offset + 1];
    result[offset + 2] = 255 - result[offset + 2];
  }
  return result;
}

function rotate90(pixels: Uint8ClampedArray, width: number, height: number) {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const targetX = height - y - 1;
      const targetY = x;
      result.set(pixels.subarray(source, source + 4), (targetY * height + targetX) * 4);
    }
  }
  return result;
}

interface MarkerPairCandidate {
  marker: readonly [number, number];
  first: number;
  last: number;
  count: number;
  cells: number;
  score: number;
}

function markerPairCandidates(bytes: Uint8Array) {
  const candidates: MarkerPairCandidate[] = [];
  for (const phase of [0, 1]) {
    const stats = new Map<number, { first: number; last: number; count: number }>();
    for (let offset = phase; offset + 1 < bytes.length; offset += 2) {
      const key = (bytes[offset] << 8) | bytes[offset + 1];
      const current = stats.get(key);
      if (current) {
        current.last = offset;
        current.count += 1;
      } else stats.set(key, { first: offset, last: offset, count: 1 });
    }
    for (const [key, stat] of stats) {
      if (key === 0 || key === 0xffff || stat.count < 32) continue;
      const cells = Math.floor((stat.last - stat.first) / 2) + 1;
      const density = stat.count / cells;
      if (cells < 64 || cells > 2_097_152 || density < 0.02 || density > 0.98) continue;
      candidates.push({
        marker: [key >>> 8, key & 0xff],
        first: stat.first,
        last: stat.last,
        count: stat.count,
        cells,
        score: stat.count * density * (1 - density),
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score || right.count - left.count).slice(0, 4);
}

function markerVisuals(bytes: Uint8Array) {
  const visuals: StegoVisual[] = [];
  let totalPixels = 0;
  const push = (visual: StegoVisual) => {
    const count = visual.width * visual.height;
    if (visuals.length >= 96 || totalPixels + count > 12_000_000) return false;
    visuals.push(visual);
    totalPixels += count;
    return true;
  };
  const commonColumns = [8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128];
  for (const candidate of markerPairCandidates(bytes)) {
    const markerHex = candidate.marker.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const markerLabel = candidate.marker.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    const widths = commonColumns.filter((columns) => {
      const rows = Math.ceil(candidate.cells / columns);
      return rows >= 8 && rows <= 4096 && candidate.first + rows * columns * 2 <= bytes.length;
    }).slice(0, 8);
    for (const columns of widths) {
      const rows = Math.ceil(candidate.cells / columns);
      const pixels = matrixPixels(bytes, candidate.first, rows, columns, candidate.marker);
      const suffix = columns === 8 ? "" : `-w${columns}`;
      const id = `marker-${markerHex}${suffix}`;
      const detail = `${candidate.count} 个 ${markerLabel} 标记；起点 0x${candidate.first.toString(16)}；每行 ${columns * 2} 字节、每 2 字节一个像素`;
      if (!push({ id, label: `${markerLabel} 标记矩阵 (${columns} 列)`, width: columns, height: rows, pixels, detail })) return visuals;
      if (!push({ id: `${id}-inverted`, label: `${markerLabel} 标记矩阵反相`, width: columns, height: rows, pixels: invertPixels(pixels), detail })) return visuals;
      if (!push({ id: `${id}-transposed`, label: `${markerLabel} 标记矩阵转置`, width: rows, height: columns, pixels: transpose(pixels, columns, rows, false), detail })) return visuals;
      if (!push({ id: `${id}-transposed-inverted`, label: `${markerLabel} 标记矩阵转置反相`, width: rows, height: columns, pixels: transpose(pixels, columns, rows, true), detail })) return visuals;
      if (!push({ id: `${id}-rotated-90`, label: `${markerLabel} 标记矩阵顺时针旋转 90°`, width: rows, height: columns, pixels: rotate90(pixels, columns, rows), detail })) return visuals;
    }
  }
  return visuals;
}

function markerTextCandidates(
  bytes: Uint8Array,
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const candidates: StegoChannelCandidate[] = [];
  for (const marker of markerPairCandidates(bytes)) {
    for (const decoded of decodeMarkerHighlightText(bytes, marker.marker, marker.first, marker.last)) {
      for (const hit of detectFlags(decoded.text, prefixes, caseSensitive)) {
        const assessment = assessFlagCandidate(hit.text);
        candidates.push({
          id: `byte-marker-text-${candidates.length}`,
          source: "字节标记点阵",
          label: marker.marker.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" "),
          value: hit.text,
          confidence: assessment.confidence === "high" ? "high" : "candidate",
          detail: decoded.detail,
          flags: [hit.text],
        });
      }
    }
  }
  return candidates;
}

export function analyzeByteRecipes(
  source: Uint8Array,
  prefixes: readonly string[],
  caseSensitive: boolean,
  options: ByteRecipeOptions = {},
): ByteRecipeResult {
  const maximumBytes = Math.max(1024, Math.min(16 * 1024 * 1024, Math.floor(options.maximumBytes ?? 4 * 1024 * 1024)));
  const maximumStride = Math.max(2, Math.min(32, Math.floor(options.maximumStride ?? 32)));
  const maximumCandidates = Math.max(1, Math.min(200, Math.floor(options.maximumCandidates ?? 64)));
  const bytes = source.subarray(0, maximumBytes);
  const candidates = [
    ...markerTextCandidates(bytes, prefixes, caseSensitive),
    ...strideFlags(bytes, prefixes, caseSensitive, maximumStride, maximumCandidates),
  ].slice(0, maximumCandidates);
  const visuals = markerVisuals(bytes);
  const findings: StegoFinding[] = [];
  for (const candidate of candidates) {
    const highConfidence = candidate.confidence === "high";
    findings.push({
      id: `byte-recipe-flag-${findings.length}`,
      severity: highConfidence ? "high" : "suspicious",
      source: candidate.source,
      title: highConfidence ? "字节配方发现 Flag" : "字节配方疑似 Flag",
      detail: candidate.value,
    });
  }
  if (visuals.length > 0) findings.push({
    id: "byte-marker-matrix",
    severity: "info",
    source: "字节标记配方",
    title: "发现重复标记矩阵候选",
    detail: visuals[0].detail ?? "已生成标记矩阵",
  });
  return { candidates, visuals, findings };
}
