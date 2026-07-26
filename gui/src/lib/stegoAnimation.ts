import { decompressFrames, parseGIF } from "gifuct-js";
import UPNG from "upng-js";
import type { LsbExtractedFile } from "./lsbTypes";
import type { StegoFinding, StegoVisual } from "./stegoTypes";

export interface AnimationAnalysisOptions {
  maximumFrames?: number;
  maximumDecodedBytes?: number;
  maximumSelectedFrames?: number;
}

export interface AnimationAnalysisResult {
  visuals: StegoVisual[];
  files: LsbExtractedFile[];
  findings: StegoFinding[];
}

interface DecodedAnimation {
  format: "gif" | "apng";
  width: number;
  height: number;
  frames: Uint8ClampedArray[];
}

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isGif(bytes: Uint8Array) {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  return header === "GIF87a" || header === "GIF89a";
}

function isPng(bytes: Uint8Array) {
  return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
}

function hasActl(bytes: Uint8Array) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
    if (offset + length + 12 > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") return true;
    offset += length + 12;
    if (type === "IEND") break;
  }
  return false;
}

function fillRect(pixels: Uint8ClampedArray, canvasWidth: number, dims: { left: number; top: number; width: number; height: number }, color: readonly number[]) {
  const maximumX = Math.min(canvasWidth, dims.left + dims.width);
  const canvasHeight = pixels.length / 4 / canvasWidth;
  const maximumY = Math.min(canvasHeight, dims.top + dims.height);
  for (let y = Math.max(0, dims.top); y < maximumY; y += 1) {
    for (let x = Math.max(0, dims.left); x < maximumX; x += 1) {
      const target = (y * canvasWidth + x) * 4;
      pixels[target] = color[0];
      pixels[target + 1] = color[1];
      pixels[target + 2] = color[2];
      pixels[target + 3] = color[3];
    }
  }
}

function decodeGif(bytes: Uint8Array): DecodedAnimation {
  const parsed = parseGIF(exactBuffer(bytes));
  const patches = decompressFrames(parsed, true);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const background = parsed.gct?.[parsed.lsd.backgroundColorIndex] ?? [255, 255, 255];
  const canvas = new Uint8ClampedArray(width * height * 4);
  fillRect(canvas, width, { left: 0, top: 0, width, height }, [...background, 255]);
  const frames: Uint8ClampedArray[] = [];
  let previous: typeof patches[number] | undefined;
  let previousRestore: Uint8ClampedArray | undefined;
  for (const frame of patches) {
    if (previous?.disposalType === 2) fillRect(canvas, width, previous.dims, [...background, 255]);
    else if (previous?.disposalType === 3 && previousRestore) canvas.set(previousRestore);
    const restore = canvas.slice();
    for (let y = 0; y < frame.dims.height; y += 1) {
      for (let x = 0; x < frame.dims.width; x += 1) {
        const source = (y * frame.dims.width + x) * 4;
        if (frame.patch[source + 3] === 0) continue;
        const targetX = frame.dims.left + x;
        const targetY = frame.dims.top + y;
        if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
        const target = (targetY * width + targetX) * 4;
        canvas.set(frame.patch.subarray(source, source + 4), target);
      }
    }
    frames.push(canvas.slice());
    previous = frame;
    previousRestore = restore;
  }
  return { format: "gif", width, height, frames };
}

function decodeApng(bytes: Uint8Array): DecodedAnimation {
  const decoded = UPNG.decode(exactBuffer(bytes));
  return {
    format: "apng",
    width: decoded.width,
    height: decoded.height,
    frames: UPNG.toRGBA8(decoded).map((frame) => new Uint8ClampedArray(frame)),
  };
}

interface FrameStatistics {
  dark: number;
  nonwhite: number;
}

function frameStatistics(pixels: Uint8ClampedArray): FrameStatistics {
  let dark = 0;
  let nonwhite = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    const luminance = (pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000;
    if (alpha > 16 && luminance < 128) dark += 1;
    if (alpha > 16 && luminance < 245) nonwhite += 1;
  }
  return { dark, nonwhite };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function robustScores(statistics: FrameStatistics[]) {
  const darkMedian = median(statistics.map((item) => item.dark));
  const nonwhiteMedian = median(statistics.map((item) => item.nonwhite));
  const darkMad = median(statistics.map((item) => Math.abs(item.dark - darkMedian)));
  const nonwhiteMad = median(statistics.map((item) => Math.abs(item.nonwhite - nonwhiteMedian)));
  const darkScale = Math.max(1, darkMad * 1.4826);
  const nonwhiteScale = Math.max(1, nonwhiteMad * 1.4826);
  return statistics.map((item) => Math.max(
    Math.abs(item.dark - darkMedian) / darkScale,
    Math.abs(item.nonwhite - nonwhiteMedian) / nonwhiteScale,
  ));
}

function selectedIndices(frames: Uint8ClampedArray[], maximumSelectedFrames: number) {
  const statistics = frames.map(frameStatistics);
  const frequencies = new Map<string, number>();
  for (const item of statistics) {
    const key = `${item.dark}:${item.nonwhite}`;
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const mode = [...frequencies.entries()].sort((left, right) => right[1] - left[1])[0];
  const dominantMinimum = Math.max(3, Math.ceil(frames.length * 0.25));
  let candidates: { index: number; score: number }[];
  if (mode && mode[1] >= dominantMinimum) {
    const [dark, nonwhite] = mode[0].split(":").map(Number);
    const area = Math.max(1, frames[0].length / 4);
    const darkScale = Math.max(4, area * 0.001, dark * 0.02);
    const nonwhiteScale = Math.max(4, area * 0.001, nonwhite * 0.02);
    const rarityLimit = Math.max(2, Math.ceil(frames.length * 0.1));
    candidates = statistics.map((item, index) => ({
      index,
      score: Math.max(Math.abs(item.dark - dark) / darkScale, Math.abs(item.nonwhite - nonwhite) / nonwhiteScale),
    })).filter(({ index, score }) => {
      const item = statistics[index];
      return (frequencies.get(`${item.dark}:${item.nonwhite}`) ?? 1) <= rarityLimit && score >= 2;
    });
  } else {
    candidates = robustScores(statistics)
      .map((score, index) => ({ index, score }))
      .filter(({ score }) => score >= 6);
  }
  return candidates
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maximumSelectedFrames)
    .map((frame) => frame.index)
    .sort((left, right) => left - right);
}

function encodePng(pixels: Uint8ClampedArray, width: number, height: number) {
  const copy = pixels.slice();
  return new Uint8Array(UPNG.encode([copy.buffer], width, height, 0));
}

export function analyzeAnimationFrames(bytes: Uint8Array, options: AnimationAnalysisOptions = {}): AnimationAnalysisResult {
  if (!isGif(bytes) && (!isPng(bytes) || !hasActl(bytes))) return { visuals: [], files: [], findings: [] };
  const maximumFrames = Math.max(2, Math.min(512, Math.floor(options.maximumFrames ?? 128)));
  const maximumDecodedBytes = Math.max(1024 * 1024, Math.min(512 * 1024 * 1024, Math.floor(options.maximumDecodedBytes ?? 64 * 1024 * 1024)));
  const maximumSelectedFrames = Math.max(1, Math.min(64, Math.floor(options.maximumSelectedFrames ?? 32)));
  let animation: DecodedAnimation;
  try {
    animation = isGif(bytes) ? decodeGif(bytes) : decodeApng(bytes);
  } catch (error) {
    return { visuals: [], files: [], findings: [{ id: "animation-decode-error", severity: "suspicious", source: "动画逐帧", title: "动画帧解码失败", detail: error instanceof Error ? error.message : String(error) }] };
  }
  const decodedBytes = animation.frames.length * animation.width * animation.height * 4;
  if (animation.frames.length < 2) return { visuals: [], files: [], findings: [] };
  if (animation.frames.length > maximumFrames || decodedBytes > maximumDecodedBytes) return {
    visuals: [],
    files: [],
    findings: [{ id: "animation-limit", severity: "info", source: "动画逐帧", title: "动画超出逐帧解码限制", detail: `${animation.frames.length} 帧，预计 ${decodedBytes} 字节；当前限制 ${maximumFrames} 帧 / ${maximumDecodedBytes} 字节` }],
  };
  const selected = selectedIndices(animation.frames, maximumSelectedFrames);
  const prefix = animation.format;
  const visuals: StegoVisual[] = selected.map((index) => ({
    id: `${prefix}-frame-${String(index + 1).padStart(3, "0")}`,
    label: `${animation.format === "gif" ? "GIF" : "APNG"} 异常帧 ${index + 1}`,
    width: animation.width,
    height: animation.height,
    pixels: animation.frames[index],
    detail: `像素活动统计显著偏离 ${animation.frames.length} 帧的基线，按原始帧序号导出`,
  }));
  const files: LsbExtractedFile[] = selected.map((index) => ({
    name: `${prefix}-frame-${String(index + 1).padStart(3, "0")}.png`,
    mediaType: "image/png",
    offset: index,
    bytes: encodePng(animation.frames[index], animation.width, animation.height),
  }));
  const findings: StegoFinding[] = selected.length === 0 ? [] : [{
    id: `${prefix}-rare-frames`,
    severity: "suspicious",
    source: "动画逐帧",
    title: `筛出 ${selected.length} 个像素统计异常帧`,
    detail: selected.map((index) => String(index + 1)).join("、"),
  }];
  return { visuals, files, findings };
}
