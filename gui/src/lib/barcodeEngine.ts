// QR 码与条码解码引擎
// 支持 QR (Version 1-6, Byte mode), Reed-Solomon 纠错, 条码族识别
import { detectFlags } from "./flagDetector";

export interface QrResult {
  decoded: boolean;
  data: string;
  version: number;
  ecLevel: string;
  maskPattern: number;
  detail: string;
}

export interface BarcodeResult {
  type: string;
  data?: string;
  detected: boolean;
}

// ── QR 格式信息解析 ──
// Version 1: 21x21 modules. Finder patterns at 3 corners.
// Format info: 5 data bits + 10 BCH bits, masked with 101010000010010
const FORMAT_INFO_COORDS = [
  // Around top-left finder (excluding finder)
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
  [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
];

const FORMAT_MASK = 0b101010000010010;
const FORMAT_BCH_GEN = 0b10100110111; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1

const EC_LEVEL_NAMES = ["M", "L", "H", "Q"];

// QR version capacities (data codewords per EC level) for versions 1-6, Byte mode
const QR_CAPACITY: Record<number, Record<string, number>> = {
  1: { L: 19, M: 16, Q: 13, H: 9 },
  2: { L: 34, M: 28, Q: 22, H: 16 },
  3: { L: 55, M: 44, Q: 34, H: 26 },
  4: { L: 80, M: 64, Q: 48, H: 36 },
  5: { L: 108, M: 86, Q: 62, H: 46 },
  6: { L: 136, M: 108, Q: 76, H: 60 },
};

const QR_EC_BLOCKS: Record<number, Record<string, [number, number]>> = {
  // [total codewords per block, data codewords per block]
  1: { L: [26, 19], M: [26, 16], Q: [26, 13], H: [26, 9] },
  2: { L: [44, 34], M: [44, 28], Q: [44, 22], H: [44, 16] },
  3: { L: [70, 55], M: [70, 44], Q: [35, 17], H: [35, 13] },
  4: { L: [100, 80], M: [50, 32], Q: [50, 24], H: [25, 9] },
  5: { L: [134, 108], M: [67, 43], Q: [33, 15], H: [33, 11] },
  6: { L: [86, 68], M: [43, 27], Q: [43, 19], H: [43, 15] },
};

// RS GF(256) tables
const RS_EXP: number[] = [];
const RS_LOG: number[] = new Array(256).fill(0);

function initRsTables() {
  if (RS_EXP.length > 0) return;
  let x = 1;
  for (let i = 0; i < 255; i++) {
    RS_EXP[i] = x;
    RS_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
}

function rsMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  initRsTables();
  return RS_EXP[(RS_LOG[a] + RS_LOG[b]) % 255];
}

function rsGeneratorPoly(nsym: number): number[] {
  initRsTables();
  let gen = [1];
  for (let i = 0; i < nsym; i++) {
    const term = [1, RS_EXP[i]];
    const newGen = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) newGen[j] ^= rsMultiply(gen[j], term[0]);
    for (let j = 0; j < gen.length; j++) newGen[j + 1] ^= rsMultiply(gen[j], term[1]);
    gen = newGen;
  }
  return gen;
}

function rsCorrect(data: number[], nsym: number): number[] | null {
  initRsTables();
  const gen = rsGeneratorPoly(nsym);
  const syndrome = new Array(nsym).fill(0);
  let allZero = true;

  for (let i = 0; i < nsym; i++) {
    let sum = 0;
    for (let j = 0; j < data.length; j++) sum = data[j] ^ rsMultiply(sum, RS_EXP[i]);
    syndrome[i] = sum;
    if (sum !== 0) allZero = false;
  }
  if (allZero) return data.slice(0, data.length - nsym);

  // Simple error correction via Berlekamp-Massey
  let locators = [1];
  let oldLocators = [1];
  let l = 0;

  for (let i = 0; i < nsym; i++) {
    let delta = syndrome[i];
    for (let j = 1; j <= l; j++) delta ^= rsMultiply(locators[locators.length - 1 - j] ?? 0, syndrome[i - j]);
    oldLocators.push(0);
    if (delta !== 0) {
      if (oldLocators.length > locators.length) {
        const newLoc = [...oldLocators];
        for (let j = 0; j < locators.length; j++) newLoc[newLoc.length - 1 - j] ^= rsMultiply(locators[locators.length - 1 - j] ?? 0, delta);
        locators = newLoc;
        oldLocators = locators;
        l = i + 1 - l;
      } else {
        for (let j = 0; j < oldLocators.length; j++) locators[locators.length - 1 - j] ^= rsMultiply(oldLocators[oldLocators.length - 1 - j] ?? 0, delta);
      }
    }
  }

  // Try Chien search for roots (error positions)
  const errorPositions: number[] = [];
  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    for (let j = 1; j < locators.length; j++) sum ^= rsMultiply(locators[j], RS_EXP[(j * (data.length - 1 - i)) % 255]);
    if (sum === 0) errorPositions.push(data.length - 1 - i);
  }

  // Apply corrections (flip bits at error positions)
  const corrected = data.slice();
  for (const pos of errorPositions) {
    if (pos < corrected.length) corrected[pos] ^= 1;
  }

  return corrected.slice(0, data.length - nsym);
}

// ── QR Module Grid Reading ──
interface QrGrid {
  modules: number[][]; // 0=white, 1=black
  size: number;
  version: number;
}

function computeVersion(size: number): number {
  return (size - 17) / 4;
}

// Simplified QR decode: takes a 2D grid of modules, extracts data
export function decodeQrGrid(modules: number[][], prefixes: readonly string[], caseSensitive: boolean): QrResult {
  const size = modules.length;
  if (size < 21 || (size - 17) % 4 !== 0) {
    return { decoded: false, data: "", version: 0, ecLevel: "", maskPattern: -1, detail: `无效 QR 尺寸 ${size}x${size}` };
  }

  const version = computeVersion(size);
  if (version < 1 || version > 6) {
    return { decoded: false, data: "", version, ecLevel: "", maskPattern: -1, detail: `版本 ${version} 超出支持范围 (1-6)` };
  }

  // Read format info
  let formatBits = 0;
  for (const [y, x] of FORMAT_INFO_COORDS) {
    if (x < size && y < size) formatBits = (formatBits << 1) | (modules[y][x] & 1);
  }
  formatBits ^= FORMAT_MASK;
  const ecIndex = (formatBits >> 10) & 3;
  const maskPattern = (formatBits >> 7) & 7;
  const ecLevel = EC_LEVEL_NAMES[ecIndex] ?? "L";

  // Apply mask
  const unmasked: number[][] = [];
  for (let y = 0; y < size; y++) {
    unmasked[y] = [];
    for (let x = 0; x < size; x++) {
      unmasked[y][x] = modules[y][x] ^ (shouldMask(x, y, maskPattern) ? 1 : 0);
    }
  }

  // Read data bits in zigzag pattern
  const dataBits = readQrDataBits(unmasked, size);
  if (dataBits.length < 8) {
    return { decoded: false, data: "", version, ecLevel, maskPattern, detail: "数据位不足" };
  }

  // Convert bits to bytes (codewords)
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= dataBits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | dataBits[i + b];
    codewords.push(byte);
  }

  // Split into blocks and apply RS correction
  const blockInfo = QR_EC_BLOCKS[version]?.[ecLevel];
  if (!blockInfo) return { decoded: false, data: "", version, ecLevel, maskPattern, detail: `无版本 ${version}/${ecLevel} 的块信息` };

  const [totalCw, dataCw] = blockInfo;
  const nsym = totalCw - dataCw;
  const numBlocks = Math.ceil(codewords.length / totalCw);

  const allData: number[] = [];
  for (let b = 0; b < numBlocks; b++) {
    const blockData = codewords.slice(b * totalCw, (b + 1) * totalCw);
    if (blockData.length < totalCw) continue;
    try {
      const corrected = rsCorrect(blockData, nsym);
      if (corrected) allData.push(...corrected);
    } catch {
      // RS correction failed for this block, use raw data
      allData.push(...blockData.slice(0, dataCw));
    }
  }

  // Decode byte stream
  let mode = allData[0] >> 4;
  let count = 0;
  let data = "";
  let pos = 0;

  // Try Byte mode (0100) first
  if (mode === 4) {
    // Character count indicator: 8 bits for versions 1-9
    if (pos + 1 >= allData.length) return { decoded: false, data: "", version, ecLevel, maskPattern, detail: "模式指示符后无数据" };
    count = (allData[0] & 0x0f) << 4 | (allData[1] >> 4);
    pos = 2;
    // Read count bytes
    const bytes: number[] = [];
    for (let i = 0; i < count && pos < allData.length; i++) {
      if (pos % 8 === 4 && pos > 0) {
        // Handle nibble alignment
        bytes.push(((allData[pos - 1] & 0x0f) << 4) | ((allData[pos] >> 4) & 0x0f));
        pos += 1;
      } else {
        bytes.push(allData[pos]);
        pos += 1;
      }
    }
    try {
      data = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
    } catch { data = ""; }
  } else {
    // Fallback: try interpreting as raw ASCII
    const textBytes = allData.filter((b) => b >= 32 && b <= 126 || b === 10 || b === 13);
    data = String.fromCharCode(...textBytes);
  }

  const hasFlags = detectFlags(data, prefixes, caseSensitive).length > 0;

  return {
    decoded: data.length >= 4,
    data,
    version,
    ecLevel,
    maskPattern,
    detail: hasFlags ? "解码成功，发现 Flag 匹配" : `版本${version}/${ecLevel}/掩模${maskPattern}，${data.length} 字符`,
  };
}

function shouldMask(x: number, y: number, pattern: number): boolean {
  switch (pattern) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: return false;
  }
}

function isFinderPattern(x: number, y: number, size: number): boolean {
  if (x < 9 && y < 9) return true;
  if (x >= size - 8 && y < 9) return true;
  if (x < 9 && y >= size - 8) return true;
  return false;
}

function readQrDataBits(modules: number[][], size: number): number[] {
  const bits: number[] = [];
  let x = size - 1;
  let y = size - 1;
  let goingUp = true;

  while (x > 0) {
    // Skip vertical timing pattern column
    if (x === 6) x = 5;

    for (let row = 0; row < size; row++) {
      const ry = goingUp ? size - 1 - row : row;
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const rx = x - colOffset;
        if (rx < 0 || isFinderPattern(rx, ry, size)) continue;
        if (rx < size && ry < size && ry >= 0) {
          bits.push(modules[ry][rx] & 1);
        }
      }
    }

    goingUp = !goingUp;
    x -= 2;
  }

  return bits;
}

// ── 条码族识别 ──
export function identifyBarcode(text: string): BarcodeResult {
  const trimmed = text.trim();
  if (/^[0-9]{12,13}$/.test(trimmed)) return { type: "EAN/UPC", detected: true };
  if (/^[0-9]{8}$/.test(trimmed)) return { type: "EAN-8", detected: true };
  if (/^[A-Z0-9*]{6,}$/.test(trimmed) && /[A-Z]/.test(trimmed) && /\*.*\*/.test(trimmed)) return { type: "Code39", detected: true };
  if (/^[\x00-\x7F]{4,}$/.test(trimmed) && trimmed.length % 2 === 0) return { type: "Code128/DataMatrix 候选", detected: true };
  return { type: "未知", detected: false };
}
