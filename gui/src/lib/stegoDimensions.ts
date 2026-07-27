import { unzlibSync } from "fflate";
import { analyzeJpegDct } from "./jpegDct";
import { readU16, readU32 } from "./stegoBinary";
import type { StegoFinding, StegoRepairCandidate } from "./stegoTypes";

export interface DimensionAnalysisOptions {
  maximumDimension?: number;
  maximumCandidates?: number;
}

export interface DimensionAnalysisResult {
  repairs: StegoRepairCandidate[];
  findings: StegoFinding[];
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

const CRC_REVERSE_TOP = Uint16Array.from({ length: 256 }, () => 0xffff);
for (let index = 0; index < CRC_TABLE.length; index += 1) CRC_REVERSE_TOP[CRC_TABLE[index] >>> 24] = index;

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function updateCrc(state: number, byte: number) {
  return (CRC_TABLE[(state ^ byte) & 255] ^ (state >>> 8)) >>> 0;
}

function reverseCrc(state: number, byte: number) {
  const index = CRC_REVERSE_TOP[state >>> 24];
  if (index === 0xffff) return undefined;
  return ((((state ^ CRC_TABLE[index]) << 8) | (index ^ byte)) >>> 0);
}

function updateU32Be(state: number, value: number) {
  let next = state;
  next = updateCrc(next, value >>> 24);
  next = updateCrc(next, value >>> 16);
  next = updateCrc(next, value >>> 8);
  return updateCrc(next, value);
}

function reverseBytes(state: number, bytes: readonly number[]) {
  let previous: number | undefined = state;
  for (let index = bytes.length - 1; index >= 0 && previous !== undefined; index -= 1) previous = reverseCrc(previous, bytes[index]);
  return previous;
}

function u32Bytes(value: number) {
  return [value >>> 24, value >>> 16, value >>> 8, value] as const;
}

function writeU32(bytes: Uint8Array, offset: number, value: number, order: "le" | "be") {
  if (order === "be") bytes.set(Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value), offset);
  else bytes.set(Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24), offset);
}

function writeU16Le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
}

function writeU16Be(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value >>> 8;
  bytes[offset + 1] = value;
}

function pngCrc(bytes: Uint8Array) {
  let state = 0xffffffff;
  for (const byte of bytes) state = updateCrc(state, byte);
  return (state ^ 0xffffffff) >>> 0;
}

function pngChannels(colorType: number) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return 0;
}

function inflatedPng(bytes: Uint8Array) {
  if (bytes[28] !== 0) return undefined;
  const bitDepth = bytes[24];
  const channels = pngChannels(bytes[25]);
  if (channels === 0 || ![1, 2, 4, 8, 16].includes(bitDepth)) return undefined;
  const parts: Uint8Array[] = [];
  let total = 0;
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = readU32(bytes, cursor, "be");
    const end = cursor + 12 + length;
    if (end > bytes.length) return undefined;
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (type === "IDAT") {
      const part = bytes.subarray(cursor + 8, cursor + 8 + length);
      parts.push(part);
      total += part.length;
    }
    cursor = end;
    if (type === "IEND") break;
  }
  if (parts.length === 0) return undefined;
  const compressed = new Uint8Array(total);
  let output = 0;
  for (const part of parts) {
    compressed.set(part, output);
    output += part.length;
  }
  try {
    return { bytes: unzlibSync(compressed), bitsPerPixel: bitDepth * channels };
  } catch {
    return undefined;
  }
}

function pngScanlineWidths(bytes: Uint8Array, height: number, maximumDimension: number) {
  const inflated = inflatedPng(bytes);
  if (!inflated || height < 1) return [];
  const candidates: Array<{ width: number; score: number; valid: number; distinct: number; leftover: number }> = [];
  for (let width = 1; width <= maximumDimension; width += 1) {
    const stride = 1 + Math.ceil(width * inflated.bitsPerPixel / 8);
    if (stride * height > inflated.bytes.length) continue;
    let valid = 0;
    let nonzero = 0;
    const filters = new Set<number>();
    for (let row = 0; row < height; row += 1) {
      const filter = inflated.bytes[row * stride];
      if (filter <= 4) {
        valid += 1;
        filters.add(filter);
        if (filter !== 0) nonzero += 1;
      }
    }
    if (valid < Math.ceil(height * 0.98)) continue;
    const score = (height - valid) * 100 - nonzero * 2 - filters.size * 12;
    candidates.push({ width, score, valid, distinct: filters.size, leftover: inflated.bytes.length - stride * height });
  }
  return candidates.sort((left, right) => left.score - right.score || right.distinct - left.distinct || left.width - right.width).slice(0, 24);
}

function signedU32(value: number) {
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function addRepair(repairs: StegoRepairCandidate[], candidate: Omit<StegoRepairCandidate, "id">, maximumCandidates: number) {
  if (candidate.width < 1 || candidate.height < 1 || repairs.length >= maximumCandidates) return;
  if (repairs.some((repair) => repair.format === candidate.format && repair.width === candidate.width && repair.height === candidate.height)) return;
  repairs.push({ id: `repair-${repairs.length}`, ...candidate });
}

function analyzePng(bytes: Uint8Array, repairs: StegoRepairCandidate[], maximumDimension: number, maximumCandidates: number) {
  if (bytes.length < 33 || readU32(bytes, 8, "be") !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return;
  const currentWidth = readU32(bytes, 16, "be");
  const currentHeight = readU32(bytes, 20, "be");
  const storedCrc = readU32(bytes, 29, "be");
  let currentState = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) currentState = updateCrc(currentState, byte);
  const crcMatches = ((currentState ^ 0xffffffff) >>> 0) === storedCrc;

  if (!crcMatches) {
    let prefixState = 0xffffffff;
    for (const byte of [0x49, 0x48, 0x44, 0x52]) prefixState = updateCrc(prefixState, byte);
    const widths = new Map<number, number[]>();
    for (let width = 1; width <= maximumDimension; width += 1) {
      const state = updateU32Be(prefixState, width);
      const values = widths.get(state) ?? [];
      values.push(width);
      widths.set(state, values);
    }
    const targetState = (storedCrc ^ 0xffffffff) >>> 0;
    for (let height = 1; height <= maximumDimension && repairs.length < maximumCandidates; height += 1) {
      const stateAfterWidth = reverseBytes(targetState, [...u32Bytes(height), ...bytes.subarray(24, 29)]);
      if (stateAfterWidth === undefined) continue;
      for (const width of widths.get(stateAfterWidth) ?? []) {
        const repaired = bytes.slice();
        writeU32(repaired, 16, width, "be");
        writeU32(repaired, 20, height, "be");
        addRepair(repairs, {
          format: "PNG",
          label: `IHDR CRC 精确反推 ${width} x ${height}`,
          width,
          height,
          confidence: "exact",
          detail: `记录 CRC 0x${storedCrc.toString(16).padStart(8, "0")}；原尺寸 ${currentWidth} x ${currentHeight}`,
          bytes: repaired,
        }, maximumCandidates);
      }
    }
  }
  const scanlines = pngScanlineWidths(bytes, currentHeight, maximumDimension);
  const currentScanline = scanlines.find((candidate) => candidate.width === currentWidth);
  if (crcMatches && currentScanline?.valid === currentHeight && currentScanline.leftover === 0) return;
  for (const scanline of scanlines) {
    if (scanline.width === currentWidth) continue;
    const repaired = bytes.slice();
    writeU32(repaired, 16, scanline.width, "be");
    writeU32(repaired, 29, pngCrc(repaired.subarray(12, 29)), "be");
    addRepair(repairs, {
      format: "PNG",
      label: `解压扫描线候选 ${scanline.width} x ${currentHeight}`,
      width: scanline.width,
      height: currentHeight,
      confidence: "candidate",
      detail: `合并 IDAT 并解压，${scanline.valid}/${currentHeight} 行命中过滤字节，包含 ${scanline.distinct} 种过滤器，声明行后剩余 ${scanline.leftover} 字节；已重算 IHDR CRC，需预览确认`,
      bytes: repaired,
    }, maximumCandidates);
  }
}

function bmpStride(width: number, bitsPerPixel: number) {
  return Math.ceil(width * bitsPerPixel / 32) * 4;
}

function analyzeBmp(bytes: Uint8Array, repairs: StegoRepairCandidate[], maximumDimension: number, maximumCandidates: number) {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d || readU32(bytes, 14, "le") < 40) return;
  const pixelOffset = readU32(bytes, 10, "le");
  const currentWidth = Math.abs(signedU32(readU32(bytes, 18, "le")));
  const rawHeight = signedU32(readU32(bytes, 22, "le"));
  const currentHeight = Math.abs(rawHeight);
  const bitsPerPixel = readU16(bytes, 28, "le");
  const compression = readU32(bytes, 30, "le");
  if (pixelOffset >= bytes.length || currentWidth < 1 || currentHeight < 1 || bitsPerPixel < 1 || compression !== 0) return;
  const declaredSize = readU32(bytes, 2, "le");
  const logicalEnd = declaredSize >= pixelOffset && declaredSize <= bytes.length ? declaredSize : bytes.length;
  const pixelBytes = logicalEnd - pixelOffset;
  const currentStride = bmpStride(currentWidth, bitsPerPixel);
  const inferredHeight = Math.floor(pixelBytes / currentStride);
  if (inferredHeight >= 1 && inferredHeight <= maximumDimension && inferredHeight !== currentHeight && pixelBytes - inferredHeight * currentStride <= 4) {
    const repaired = bytes.slice();
    writeU32(repaired, 22, rawHeight < 0 ? (0x100000000 - inferredHeight) >>> 0 : inferredHeight, "le");
    addRepair(repairs, {
      format: "BMP",
      label: `像素数据精确反推高度 ${inferredHeight}`,
      width: currentWidth,
      height: inferredHeight,
      confidence: "exact",
      detail: `${pixelBytes} 像素字节，${bitsPerPixel} bpp，行跨度 ${currentStride}`,
      bytes: repaired,
    }, maximumCandidates);
  }
  for (let width = 1; width <= maximumDimension && repairs.length < maximumCandidates; width += 1) {
    if (width === currentWidth) continue;
    const stride = bmpStride(width, bitsPerPixel);
    const delta = Math.abs(pixelBytes - stride * currentHeight);
    if (delta > 4) continue;
    const repaired = bytes.slice();
    writeU32(repaired, 18, width, "le");
    addRepair(repairs, {
      format: "BMP",
      label: `行跨度精确反推宽度 ${width}`,
      width,
      height: currentHeight,
      confidence: "exact",
      detail: `${pixelBytes} 像素字节，${currentHeight} 行，${bitsPerPixel} bpp，余量 ${delta} 字节`,
      bytes: repaired,
    }, maximumCandidates);
  }
}

interface JpegFrameHeader {
  offset: number;
  width: number;
  height: number;
}

function jpegFrameHeader(bytes: Uint8Array): JpegFrameHeader | undefined {
  if (!startsWith(bytes, [0xff, 0xd8])) return undefined;
  let cursor = 2;
  while (cursor + 9 < bytes.length) {
    if (bytes[cursor] !== 0xff) return undefined;
    while (bytes[cursor] === 0xff) cursor += 1;
    const markerOffset = cursor - 1;
    const marker = bytes[cursor++];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (cursor + 2 > bytes.length) return undefined;
    const length = readU16(bytes, cursor, "be");
    if (length < 2 || cursor + length > bytes.length) return undefined;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { offset: markerOffset, height: readU16(bytes, markerOffset + 5, "be"), width: readU16(bytes, markerOffset + 7, "be") };
    }
    cursor += length;
  }
  return undefined;
}

function roundness(value: number, vertical: boolean) {
  if (value % 100 === 0) return vertical ? -40 : -24;
  if (value % 50 === 0) return vertical ? -28 : -16;
  if (value % 10 === 0) return vertical ? -18 : -10;
  if (value % 4 === 0) return -6;
  if (value % 2 === 0) return -2;
  return 0;
}

interface JpegDimensionCandidate {
  width: number;
  height: number;
  decodedMcus: number;
  mcuWidth: number;
  mcuHeight: number;
  score: number;
}

function inferJpegMcuDimensions(
  bytes: Uint8Array,
  header: JpegFrameHeader,
  report: ReturnType<typeof analyzeJpegDct>,
  maximumDimension: number,
) {
  const mcuWidth = report.mcuWidth;
  const mcuHeight = report.mcuHeight;
  const blocksPerMcu = report.blocksPerMcu;
  if (!mcuWidth || !mcuHeight || !blocksPerMcu) return [];
  const maximumMcus = Math.floor(1_900_000 / blocksPerMcu);
  const sideMcus = Math.max(1, Math.floor(Math.sqrt(maximumMcus)));
  const probeWidth = Math.min(maximumDimension, sideMcus * mcuWidth);
  const probeHeight = Math.min(maximumDimension, Math.floor(maximumMcus / Math.ceil(probeWidth / mcuWidth)) * mcuHeight);
  if (probeWidth < 1 || probeHeight < 1) return [];
  const probe = bytes.slice();
  writeU16Be(probe, header.offset + 5, probeHeight);
  writeU16Be(probe, header.offset + 7, probeWidth);
  const decoded = analyzeJpegDct(probe);
  const decodedMcus = decoded.decodedMcus ?? 0;
  const reachedEnd = decoded.warnings.some((warning) => /FFD9|标记 FF[Dd]9/.test(warning))
    || decoded.warnings.length > 0 && (decoded.entropyBytesRemaining ?? Number.MAX_SAFE_INTEGER) <= 4;
  if (!decoded.supported || !reachedEnd || decodedMcus <= (report.decodedMcus ?? 0)) return [];

  const candidates: JpegDimensionCandidate[] = [];
  for (let columns = 1; columns * columns <= decodedMcus; columns += 1) {
    if (decodedMcus % columns !== 0) continue;
    for (const [mcuColumns, mcuRows] of [[columns, decodedMcus / columns], [decodedMcus / columns, columns]]) {
      const minimumWidth = (mcuColumns - 1) * mcuWidth + 1;
      const maximumWidth = Math.min(mcuColumns * mcuWidth, maximumDimension);
      const minimumHeight = (mcuRows - 1) * mcuHeight + 1;
      const maximumHeight = Math.min(mcuRows * mcuHeight, maximumDimension);
      if (minimumWidth > maximumWidth || minimumHeight > maximumHeight) continue;
      for (let width = minimumWidth; width <= maximumWidth; width += 1) {
        for (let height = minimumHeight; height <= maximumHeight; height += 1) {
          const sameAxisBonus = (width === header.width ? -100_000 : 0) + (height === header.height ? -80_000 : 0);
          const score = sameAxisBonus + Math.abs(width - header.width) + Math.abs(height - header.height)
            + roundness(width, false) + roundness(height, true);
          candidates.push({ width, height, decodedMcus, mcuWidth, mcuHeight, score });
          if (candidates.length >= 50_000) break;
        }
        if (candidates.length >= 50_000) break;
      }
      if (candidates.length >= 50_000) break;
    }
    if (candidates.length >= 50_000) break;
  }
  return candidates.sort((left, right) => left.score - right.score || left.width - right.width || left.height - right.height);
}

function analyzeJpeg(bytes: Uint8Array, repairs: StegoRepairCandidate[], maximumDimension: number, maximumCandidates: number) {
  const header = jpegFrameHeader(bytes);
  if (!header) return;
  const report = analyzeJpegDct(bytes);
  if (!report.supported || report.warnings.length === 0 && (report.entropyBytesRemaining ?? 0) <= 64) return;
  const inferred = inferJpegMcuDimensions(bytes, header, report, maximumDimension);
  // Common candidate heights including well-known values and heights near the declared height
  const commonHeights = [...new Set([
    255, 256, 300, 512, 600, 720, 768, 900, 1080,
    header.height + 1, header.height + 2, // offset by 1-2 (common dimension watermark)
    128, 129, // common small heights
  ].filter((height) => height !== header.height && height > 0 && height <= maximumDimension))];

  // Phase 1: MCU-inferred dimensions (strongest evidence)
  for (const candidate of inferred.slice(0, 16)) {
    if (repairs.length >= maximumCandidates) break;
    const repaired = bytes.slice();
    writeU16Be(repaired, header.offset + 5, candidate.height);
    writeU16Be(repaired, header.offset + 7, candidate.width);
    addRepair(repairs, {
      format: "JPEG",
      label: `SOF MCU 推演 ${candidate.width} x ${candidate.height}`,
      width: candidate.width,
      height: candidate.height,
      confidence: "candidate",
      detail: `完整熵流解出 ${candidate.decodedMcus} 个 MCU；MCU 尺寸 ${candidate.mcuWidth} x ${candidate.mcuHeight}`,
      bytes: repaired,
    }, maximumCandidates);
  }

  // Phase 2: Same declared width, common heights only (most frequent real case)
  for (const height of commonHeights) {
    if (repairs.length >= maximumCandidates) break;
    const repaired = bytes.slice();
    writeU16Be(repaired, header.offset + 5, height);
    addRepair(repairs, {
      format: "JPEG",
      label: `高度修正 ${header.width} x ${height}`,
      width: header.width,
      height,
      confidence: "candidate",
      detail: `原尺寸 ${header.width} x ${header.height}；仅修改高度为常见值 ${height}`,
      bytes: repaired,
    }, maximumCandidates);
  }

  // Phase 3: Brute-force enumeration (fill remaining budget)
  if (repairs.length < maximumCandidates) {
    const remaining = maximumCandidates - repairs.length;
    const widthCandidates = Array.from({ length: Math.min(129, maximumDimension - header.width + 1) }, (_, delta) => header.width + delta)
      .sort((left, right) => roundness(left, false) - roundness(right, false) || Math.abs(left - header.width) - Math.abs(right - header.width))
      .slice(0, 40);
    for (const height of commonHeights) {
      for (const width of widthCandidates) {
        if (repairs.length >= maximumCandidates) break;
        const repaired = bytes.slice();
        writeU16Be(repaired, header.offset + 5, height);
        writeU16Be(repaired, header.offset + 7, width);
        addRepair(repairs, {
          format: "JPEG",
          label: `SOF 枚举 ${width} x ${height}`,
          width, height,
          confidence: "candidate",
          detail: `原尺寸 ${header.width} x ${header.height}`,
          bytes: repaired,
        }, maximumCandidates);
      }
    }
  }
}

function skipGifSubBlocks(bytes: Uint8Array, start: number) {
  const parts: Uint8Array[] = [];
  let length = 0;
  let cursor = start;
  while (cursor < bytes.length) {
    const size = bytes[cursor++];
    if (size === 0) break;
    if (cursor + size > bytes.length) return { cursor: bytes.length, data: new Uint8Array() };
    const part = bytes.subarray(cursor, cursor + size);
    parts.push(part);
    length += size;
    cursor += size;
  }
  const data = new Uint8Array(length);
  let output = 0;
  for (const part of parts) {
    data.set(part, output);
    output += part.length;
  }
  return { cursor, data };
}

function gifPixelCount(data: Uint8Array, minimumCodeSize: number) {
  if (minimumCodeSize < 2 || minimumCodeSize > 8) return undefined;
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  let codeSize = minimumCodeSize + 1;
  let nextCode = end + 1;
  let bitOffset = 0;
  let previous = -1;
  let output = 0;
  const lengths = new Uint32Array(4096);
  const reset = () => {
    lengths.fill(0);
    for (let code = 0; code < clear; code += 1) lengths[code] = 1;
    codeSize = minimumCodeSize + 1;
    nextCode = end + 1;
    previous = -1;
  };
  const readCode = () => {
    if (bitOffset + codeSize > data.length * 8) return undefined;
    let value = 0;
    for (let bit = 0; bit < codeSize; bit += 1) value |= ((data[(bitOffset + bit) >>> 3] >>> ((bitOffset + bit) & 7)) & 1) << bit;
    bitOffset += codeSize;
    return value;
  };
  reset();
  while (output <= 100_000_000) {
    const code = readCode();
    if (code === undefined || code === end) break;
    if (code === clear) {
      reset();
      continue;
    }
    const length = code < nextCode ? lengths[code] : code === nextCode && previous >= 0 ? lengths[previous] + 1 : 0;
    if (length === 0) return undefined;
    output += length;
    if (previous >= 0 && nextCode < 4096) {
      lengths[nextCode++] = lengths[previous] + 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    previous = code;
  }
  return output > 0 ? output : undefined;
}

interface GifDecodedFrame {
  descriptorOffset: number;
  left: number;
  top: number;
  width: number;
  height: number;
  pixelCount?: number;
}

function parseGifFrames(bytes: Uint8Array) {
  const frames: GifDecodedFrame[] = [];
  if (bytes.length < 13) return frames;
  let cursor = 13;
  if ((bytes[10] & 0x80) !== 0) cursor += 3 * (1 << ((bytes[10] & 7) + 1));
  while (cursor < bytes.length && frames.length < 10_000) {
    const introducerOffset = cursor;
    const introducer = bytes[cursor++];
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      cursor += 1;
      cursor = skipGifSubBlocks(bytes, cursor).cursor;
      continue;
    }
    if (introducer !== 0x2c || cursor + 9 > bytes.length) break;
    const left = readU16(bytes, cursor, "le");
    const top = readU16(bytes, cursor + 2, "le");
    const width = readU16(bytes, cursor + 4, "le");
    const height = readU16(bytes, cursor + 6, "le");
    const packed = bytes[cursor + 8];
    cursor += 9;
    if ((packed & 0x80) !== 0) cursor += 3 * (1 << ((packed & 7) + 1));
    const minimumCodeSize = bytes[cursor++];
    const blocks = skipGifSubBlocks(bytes, cursor);
    cursor = blocks.cursor;
    frames.push({ descriptorOffset: introducerOffset, left, top, width, height, pixelCount: gifPixelCount(blocks.data, minimumCodeSize) });
  }
  return frames;
}

function gifDimensionPairs(frame: GifDecodedFrame, maximumDimension: number) {
  const pairs = new Map<string, { width: number; height: number; score: number; exactAxis: boolean }>();
  const count = frame.pixelCount;
  if (!count) return [];
  const add = (width: number, height: number, exactAxis: boolean) => {
    if (width < 1 || height < 1 || width > maximumDimension || height > maximumDimension || width * height !== count) return;
    const score = Math.abs(width - frame.width) + Math.abs(height - frame.height) * 0.25 - (exactAxis ? 1000 : 0);
    pairs.set(`${width}:${height}`, { width, height, score, exactAxis });
  };
  if (count % frame.width === 0) add(frame.width, count / frame.width, true);
  if (count % frame.height === 0) add(count / frame.height, frame.height, true);
  for (let divisor = 1; divisor * divisor <= count; divisor += 1) {
    if (count % divisor !== 0) continue;
    add(divisor, count / divisor, false);
    add(count / divisor, divisor, false);
  }
  return [...pairs.values()].sort((left, right) => left.score - right.score).slice(0, 24);
}

function analyzeGif(bytes: Uint8Array, repairs: StegoRepairCandidate[], maximumDimension: number, maximumCandidates: number) {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF87a" && String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF89a") return;
  const globalWidth = readU16(bytes, 6, "le");
  const globalHeight = readU16(bytes, 8, "le");
  const frames = parseGifFrames(bytes);
  const votes = new Map<string, { width: number; height: number; score: number; exactAxis: boolean; votes: number }>();
  const damagedFrames = frames.filter((frame) => frame.pixelCount !== undefined && frame.pixelCount !== frame.width * frame.height);
  for (const frame of damagedFrames) {
    for (const pair of gifDimensionPairs(frame, maximumDimension)) {
      const key = `${pair.width}:${pair.height}`;
      const current = votes.get(key);
      votes.set(key, current
        ? { ...current, score: current.score + pair.score, exactAxis: current.exactAxis || pair.exactAxis, votes: current.votes + 1 }
        : { ...pair, votes: 1 });
    }
  }
  const ranked = [...votes.values()]
    .filter((pair) => pair.width !== globalWidth || pair.height !== globalHeight)
    .sort((left, right) => right.votes - left.votes || Number(right.exactAxis) - Number(left.exactAxis) || left.score - right.score)
    .slice(0, maximumCandidates);

  for (const pair of ranked) {
    const repaired = bytes.slice();
    writeU16Le(repaired, 6, pair.width);
    writeU16Le(repaired, 8, pair.height);
    let changedFrames = 0;
    for (const frame of damagedFrames) {
      if (frame.pixelCount !== pair.width * pair.height) continue;
      writeU16Le(repaired, frame.descriptorOffset + 5, pair.width);
      writeU16Le(repaired, frame.descriptorOffset + 7, pair.height);
      changedFrames += 1;
    }
    if (changedFrames === 0) continue;
    addRepair(repairs, {
      format: "GIF",
      label: `LZW 像素数反推 ${pair.width} x ${pair.height}`,
      width: pair.width,
      height: pair.height,
      confidence: pair.exactAxis ? "exact" : "candidate",
      detail: `${changedFrames}/${damagedFrames.length} 个尺寸异常帧的解码像素数与候选尺寸完全一致；共 ${frames.length} 帧，原画布 ${globalWidth} x ${globalHeight}`,
      bytes: repaired,
    }, maximumCandidates);
  }

  const layoutBases = ranked.slice(0, 4);
  const layoutPriority: Array<{ width: number; height: number; baseWidth: number; baseHeight: number }> = [];
  const layoutCandidates: Array<{ width: number; height: number; baseWidth: number; baseHeight: number }> = [];
  for (const base of layoutBases) {
    const commonHeights = [...new Set([
      base.height,
      base.height < 255 ? 255 : undefined,
      base.height < 256 ? 256 : undefined,
      Math.ceil(base.height / 50) * 50,
      Math.ceil(base.height / 100) * 100,
    ].filter((value): value is number => value !== undefined && value >= base.height && value <= maximumDimension))];
    for (const height of commonHeights) {
      layoutPriority.push({ width: base.width, height, baseWidth: base.width, baseHeight: base.height });
      for (let delta = 0; delta <= 64 && base.width + delta <= maximumDimension; delta += 1) {
        layoutCandidates.push({ width: base.width + delta, height, baseWidth: base.width, baseHeight: base.height });
      }
    }
  }
  layoutCandidates.sort((left, right) => roundness(left.height, true) - roundness(right.height, true)
    || roundness(left.width, false) - roundness(right.width, false)
    || Math.abs(left.width - left.baseWidth) - Math.abs(right.width - right.baseWidth));
  for (const candidate of [...layoutPriority, ...layoutCandidates]) {
    if (repairs.length >= maximumCandidates) break;
    if (candidate.width === candidate.baseWidth && candidate.height === candidate.baseHeight) continue;
    const repaired = bytes.slice();
    writeU16Le(repaired, 6, candidate.width);
    writeU16Le(repaired, 8, candidate.height);
    let changedFrames = 0;
    for (const frame of frames) {
      if (frame.width !== globalWidth || frame.height !== globalHeight && frame.pixelCount === frame.width * frame.height) continue;
      writeU16Le(repaired, frame.descriptorOffset + 5, candidate.width);
      writeU16Le(repaired, frame.descriptorOffset + 7, candidate.height);
      changedFrames += 1;
    }
    if (changedFrames === 0) continue;
    addRepair(repairs, {
      format: "GIF",
      label: `画布与帧联动候选 ${candidate.width} x ${candidate.height}`,
      width: candidate.width,
      height: candidate.height,
      confidence: "candidate",
      detail: `以 LZW 像素数候选 ${candidate.baseWidth} x ${candidate.baseHeight} 为下界，联动修改逻辑画布和 ${changedFrames} 个图像描述符；需预览确认行重排结果`,
      bytes: repaired,
    }, maximumCandidates);
  }
}

export function analyzeImageDimensions(bytes: Uint8Array, options: DimensionAnalysisOptions = {}): DimensionAnalysisResult {
  const maximumDimension = Math.max(64, Math.min(16_384, Math.floor(options.maximumDimension ?? 4096)));
  const maximumCandidates = Math.max(1, Math.min(256, Math.floor(options.maximumCandidates ?? 256)));
  const repairs: StegoRepairCandidate[] = [];
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) analyzePng(bytes, repairs, maximumDimension, maximumCandidates);
  else if (bytes[0] === 0x42 && bytes[1] === 0x4d) analyzeBmp(bytes, repairs, maximumDimension, maximumCandidates);
  else if (startsWith(bytes, [0xff, 0xd8])) analyzeJpeg(bytes, repairs, maximumDimension, Math.min(48, maximumCandidates));
  else analyzeGif(bytes, repairs, maximumDimension, maximumCandidates);
  const findings: StegoFinding[] = repairs.length > 0 ? [{
    id: "dimension-repairs",
    severity: repairs.some((repair) => repair.confidence === "exact") ? "suspicious" : "info",
    source: "尺寸恢复",
    title: `生成 ${repairs.length} 个尺寸修复候选`,
    detail: repairs.slice(0, 6).map((repair) => `${repair.width} x ${repair.height}${repair.confidence === "exact" ? "（精确）" : ""}`).join(" · "),
  }] : [];
  return { repairs, findings };
}
