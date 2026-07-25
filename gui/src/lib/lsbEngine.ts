import type {
  LsbExtractionParameters,
  LsbImageSource,
  LsbScan,
  LsbSourceToken,
} from "./lsbTypes";

const DEFAULT_BYTE_LIMIT = 128 * 1024 * 1024;
const CHANNEL_OFFSETS = { R: 0, G: 1, B: 2, A: 3 } as const;

export const DEFAULT_LSB_PARAMETERS: LsbExtractionParameters = {
  sourceKind: "rgba",
  sources: [
    { channel: "R", bit: 0 },
    { channel: "G", bit: 0 },
    { channel: "B", bit: 0 },
  ],
  scan: {
    major: "row",
    x: "left-to-right",
    y: "top-to-bottom",
    serpentine: false,
    reversePixels: false,
  },
  layout: "pixel-interleaved",
  packing: "msb-first",
  bitOffset: 0,
  invertBits: false,
  reverseBytes: false,
  byteOffset: 0,
};

function orderedRange(length: number, forward: boolean) {
  return Array.from({ length }, (_, index) => forward ? index : length - index - 1);
}

function* iteratePixelIndexes(width: number, height: number, scan: LsbScan): Generator<number> {
  const xs = orderedRange(width, scan.x === "left-to-right");
  const ys = orderedRange(height, scan.y === "top-to-bottom");
  if (scan.reversePixels) {
    const indexes = [...iteratePixelIndexes(width, height, { ...scan, reversePixels: false })];
    yield* indexes.reverse();
    return;
  }

  if (scan.major === "row") {
    for (const [rowIndex, y] of ys.entries()) {
      const rowXs = scan.serpentine && rowIndex % 2 === 1 ? [...xs].reverse() : xs;
      for (const x of rowXs) yield y * width + x;
    }
  } else {
    for (const [columnIndex, x] of xs.entries()) {
      const columnYs = scan.serpentine && columnIndex % 2 === 1 ? [...ys].reverse() : ys;
      for (const y of columnYs) yield y * width + x;
    }
  }
}

export function scanPixelIndexes(width: number, height: number, scan: LsbScan): number[] {
  return [...iteratePixelIndexes(width, height, scan)];
}

export function validateLsbParameters(source: LsbImageSource, parameters: LsbExtractionParameters): string[] {
  const errors: string[] = [];
  const pixelCount = source.width * source.height;
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width <= 0 || source.height <= 0) {
    errors.push("图片尺寸必须是正整数");
  }
  if (source.rgba.length < pixelCount * 4) errors.push("RGBA 像素数据长度不足");
  if (parameters.sources.length === 0) errors.push("至少选择一个数据源");
  if (parameters.sourceKind === "rgba" && parameters.sources.some((item) => item.channel === "I")) {
    errors.push("索引通道仅适用于 PNG 调色板数据源");
  }
  if (parameters.sourceKind === "palette-index") {
    if (!source.paletteIndices || source.paletteIndices.length < pixelCount) {
      errors.push("当前图片没有可用的调色板索引");
    }
    if (parameters.sources.some((item) => item.channel !== "I")) {
      errors.push("PNG 调色板数据源只能读取索引通道");
    }
  }
  if (!Number.isInteger(parameters.byteOffset) || parameters.byteOffset < 0) {
    errors.push("字节偏移必须是非负整数");
  }
  if (parameters.byteLimit !== undefined && (!Number.isInteger(parameters.byteLimit) || parameters.byteLimit <= 0)) {
    errors.push("输出上限必须是正整数");
  }
  return errors;
}

function readBit(source: LsbImageSource, sourceKind: LsbExtractionParameters["sourceKind"], pixelIndex: number, token: LsbSourceToken) {
  if (sourceKind === "palette-index") {
    return ((source.paletteIndices?.[pixelIndex] ?? 0) >> token.bit) & 1;
  }
  const offset = CHANNEL_OFFSETS[token.channel as keyof typeof CHANNEL_OFFSETS];
  return (source.rgba[pixelIndex * 4 + offset] >> token.bit) & 1;
}

function* iterateBits(source: LsbImageSource, parameters: LsbExtractionParameters): Generator<number> {
  if (parameters.layout === "pixel-interleaved") {
    for (const pixelIndex of iteratePixelIndexes(source.width, source.height, parameters.scan)) {
      for (const token of parameters.sources) yield readBit(source, parameters.sourceKind, pixelIndex, token);
    }
    return;
  }
  const pixels = [...iteratePixelIndexes(source.width, source.height, parameters.scan)];
  for (const token of parameters.sources) {
    for (const pixelIndex of pixels) yield readBit(source, parameters.sourceKind, pixelIndex, token);
  }
}

function endsWithBytes(value: number[], suffix: Uint8Array) {
  if (suffix.length === 0 || suffix.length > value.length) return false;
  const start = value.length - suffix.length;
  return suffix.every((byte, index) => value[start + index] === byte);
}

export function extractLsb(source: LsbImageSource, parameters: LsbExtractionParameters): Uint8Array {
  const errors = validateLsbParameters(source, parameters);
  if (errors.length > 0) throw new Error(errors.join("；"));

  const output: number[] = [];
  const terminator = parameters.terminator ? new TextEncoder().encode(parameters.terminator) : undefined;
  const byteLimit = parameters.byteLimit ?? DEFAULT_BYTE_LIMIT;
  let bitIndex = 0;
  let bitCount = 0;
  let currentByte = 0;
  let packedBytes = 0;

  for (const sourceBit of iterateBits(source, parameters)) {
    if (bitIndex++ < parameters.bitOffset) continue;
    const bit = parameters.invertBits ? sourceBit ^ 1 : sourceBit;
    if (parameters.packing === "msb-first") currentByte = (currentByte << 1) | bit;
    else currentByte |= bit << bitCount;
    bitCount += 1;
    if (bitCount < 8) continue;

    if (packedBytes >= parameters.byteOffset) {
      output.push(currentByte);
      if ((terminator && endsWithBytes(output, terminator)) || output.length >= byteLimit) break;
    }
    packedBytes += 1;
    bitCount = 0;
    currentByte = 0;
  }

  if (parameters.reverseBytes) output.reverse();
  return Uint8Array.from(output);
}
