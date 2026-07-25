import { readU16 } from "./stegoBinary";
import type { JpegDctReport } from "./stegoTypes";

interface HuffmanTable {
  symbols: Map<number, number>;
}

interface FrameComponent {
  id: number;
  horizontal: number;
  vertical: number;
  quantizationTable: number;
}

interface Frame {
  width: number;
  height: number;
  components: FrameComponent[];
}

interface ScanComponent {
  component: FrameComponent;
  dcTable: number;
  acTable: number;
}

class EntropyEnd extends Error {
  constructor(readonly marker?: number) {
    super(marker === undefined ? "JPEG 熵编码数据被截断" : `JPEG 熵编码遇到标记 FF${marker.toString(16).toUpperCase()}`);
  }
}

class EntropyReader {
  private current = 0;
  private remaining = 0;
  cursor: number;

  constructor(private readonly bytes: Uint8Array, start: number, private readonly onRestart: () => void) {
    this.cursor = start;
  }

  private nextByte(): number {
    while (this.cursor < this.bytes.length) {
      const value = this.bytes[this.cursor++];
      if (value !== 0xff) return value;
      while (this.bytes[this.cursor] === 0xff) this.cursor += 1;
      if (this.cursor >= this.bytes.length) throw new EntropyEnd();
      const marker = this.bytes[this.cursor++];
      if (marker === 0x00) return 0xff;
      if (marker >= 0xd0 && marker <= 0xd7) {
        this.remaining = 0;
        this.onRestart();
        continue;
      }
      throw new EntropyEnd(marker);
    }
    throw new EntropyEnd();
  }

  readBit() {
    if (this.remaining === 0) {
      this.current = this.nextByte();
      this.remaining = 8;
    }
    this.remaining -= 1;
    return (this.current >>> this.remaining) & 1;
  }

  readBits(count: number) {
    let value = 0;
    for (let index = 0; index < count; index += 1) value = (value << 1) | this.readBit();
    return value;
  }
}

function unsupported(reason: string, partial: Partial<JpegDctReport> = {}): JpegDctReport {
  return { supported: false, reason, warnings: [], ...partial };
}

function parseHuffmanTables(payload: Uint8Array, tables: Map<string, HuffmanTable>) {
  let cursor = 0;
  while (cursor < payload.length) {
    const specification = payload[cursor++];
    const tableClass = specification >>> 4;
    const tableId = specification & 0x0f;
    if (tableClass > 1 || cursor + 16 > payload.length) throw new Error("DHT 表头损坏");
    const counts = payload.subarray(cursor, cursor + 16);
    cursor += 16;
    const symbolCount = counts.reduce((sum, count) => sum + count, 0);
    if (cursor + symbolCount > payload.length) throw new Error("DHT 符号表被截断");
    const symbols = new Map<number, number>();
    let code = 0;
    let symbolIndex = 0;
    for (let length = 1; length <= 16; length += 1) {
      for (let index = 0; index < counts[length - 1]; index += 1) {
        symbols.set((length << 16) | code, payload[cursor + symbolIndex]);
        code += 1;
        symbolIndex += 1;
      }
      code <<= 1;
    }
    cursor += symbolCount;
    tables.set(`${tableClass}:${tableId}`, { symbols });
  }
}

function parseQuantizationTables(payload: Uint8Array, tables: Set<number>) {
  let cursor = 0;
  while (cursor < payload.length) {
    const specification = payload[cursor++];
    const precision = specification >>> 4;
    const id = specification & 0x0f;
    const length = precision === 0 ? 64 : precision === 1 ? 128 : 0;
    if (length === 0 || cursor + length > payload.length) throw new Error("DQT 表被截断");
    tables.add(id);
    cursor += length;
  }
}

function parseFrame(payload: Uint8Array): Frame {
  if (payload.length < 6 || payload[0] !== 8) throw new Error("只支持 8 位 JPEG 采样精度");
  const height = readU16(payload, 1, "be");
  const width = readU16(payload, 3, "be");
  const count = payload[5];
  if (count < 1 || count > 4 || payload.length < 6 + count * 3) throw new Error("SOF0 分量表损坏");
  const components: FrameComponent[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 3;
    const sampling = payload[offset + 1];
    const horizontal = sampling >>> 4;
    const vertical = sampling & 0x0f;
    if (horizontal < 1 || vertical < 1 || horizontal > 4 || vertical > 4) throw new Error("JPEG 采样因子无效");
    components.push({ id: payload[offset], horizontal, vertical, quantizationTable: payload[offset + 2] });
  }
  return { width, height, components };
}

function parseScan(payload: Uint8Array, frame: Frame) {
  const count = payload[0];
  if (count < 1 || payload.length < 1 + count * 2 + 3) throw new Error("SOS 分量表损坏");
  const components: ScanComponent[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = payload[1 + index * 2];
    const selectors = payload[2 + index * 2];
    const component = frame.components.find((item) => item.id === id);
    if (!component) throw new Error(`SOS 引用了未知分量 ${id}`);
    components.push({ component, dcTable: selectors >>> 4, acTable: selectors & 0x0f });
  }
  const spectralOffset = 1 + count * 2;
  if (payload[spectralOffset] !== 0 || payload[spectralOffset + 1] !== 63 || payload[spectralOffset + 2] !== 0) throw new Error("不是 baseline sequential 扫描");
  return components;
}

function decodeSymbol(reader: EntropyReader, table: HuffmanTable) {
  let code = 0;
  for (let length = 1; length <= 16; length += 1) {
    code = (code << 1) | reader.readBit();
    const symbol = table.symbols.get((length << 16) | code);
    if (symbol !== undefined) return symbol;
  }
  throw new Error("JPEG Huffman 码不存在");
}

function receiveAndExtend(reader: EntropyReader, size: number) {
  if (size === 0) return 0;
  const value = reader.readBits(size);
  const threshold = 1 << (size - 1);
  return value < threshold ? value - ((1 << size) - 1) : value;
}

function decodeBaseline(
  bytes: Uint8Array,
  entropyOffset: number,
  frame: Frame,
  scan: ScanComponent[],
  huffmanTables: Map<string, HuffmanTable>,
  restartInterval: number,
  warnings: string[],
) {
  const maximumHorizontal = Math.max(...frame.components.map((component) => component.horizontal));
  const maximumVertical = Math.max(...frame.components.map((component) => component.vertical));
  const mcuColumns = Math.ceil(frame.width / (8 * maximumHorizontal));
  const mcuRows = Math.ceil(frame.height / (8 * maximumVertical));
  const totalMcus = mcuColumns * mcuRows;
  const estimatedBlocks = totalMcus * scan.reduce((sum, item) => sum + item.component.horizontal * item.component.vertical, 0);
  if (estimatedBlocks > 2_000_000) throw new Error("JPEG DCT 块数超过 2000000 限制");

  const predictors = new Map<number, number>();
  const coefficientCounts = Array<number>(64).fill(0);
  const oddCounts = Array<number>(64).fill(0);
  let zeroAc = 0;
  let blocks = 0;
  let mcuSinceRestart = 0;
  const resetPredictors = () => {
    predictors.clear();
    mcuSinceRestart = 0;
  };
  const reader = new EntropyReader(bytes, entropyOffset, resetPredictors);

  try {
    for (let mcu = 0; mcu < totalMcus; mcu += 1) {
      for (const item of scan) {
        const dcTable = huffmanTables.get(`0:${item.dcTable}`);
        const acTable = huffmanTables.get(`1:${item.acTable}`);
        if (!dcTable || !acTable) throw new Error(`分量 ${item.component.id} 缺少 Huffman 表`);
        const blockCount = scan.length === 1 ? 1 : item.component.horizontal * item.component.vertical;
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
          const coefficients = Array<number>(64).fill(0);
          const dcSize = decodeSymbol(reader, dcTable);
          if (dcSize > 11) throw new Error("DC 系数类别无效");
          const predictor = (predictors.get(item.component.id) ?? 0) + receiveAndExtend(reader, dcSize);
          predictors.set(item.component.id, predictor);
          coefficients[0] = predictor;
          let position = 1;
          while (position < 64) {
            const symbol = decodeSymbol(reader, acTable);
            if (symbol === 0) break;
            if (symbol === 0xf0) {
              position += 16;
              continue;
            }
            const run = symbol >>> 4;
            const size = symbol & 0x0f;
            position += run;
            if (size === 0 || position >= 64) throw new Error("AC 游程编码无效");
            coefficients[position] = receiveAndExtend(reader, size);
            position += 1;
          }
          for (let index = 0; index < 64; index += 1) {
            coefficientCounts[index] += 1;
            if (Math.abs(coefficients[index]) % 2 === 1) oddCounts[index] += 1;
            if (index > 0 && coefficients[index] === 0) zeroAc += 1;
          }
          blocks += 1;
        }
      }
      mcuSinceRestart += 1;
      if (restartInterval > 0 && mcuSinceRestart === restartInterval) mcuSinceRestart = 0;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(message.includes("截断") || error instanceof EntropyEnd ? `熵编码数据被截断：${message}` : message);
  }

  return {
    blocks,
    coefficientCounts,
    oddRatios: coefficientCounts.map((count, index) => count === 0 ? 0 : oddCounts[index] / count),
    zeroAcRatio: blocks === 0 ? 0 : zeroAc / (blocks * 63),
  };
}

export function analyzeJpegDct(bytes: Uint8Array): JpegDctReport {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return unsupported("不是 JPEG 文件");
  const huffmanTables = new Map<string, HuffmanTable>();
  const quantizationTables = new Set<number>();
  const warnings: string[] = [];
  let frame: Frame | undefined;
  let restartInterval = 0;
  let cursor = 2;

  try {
    while (cursor + 1 < bytes.length) {
      if (bytes[cursor] !== 0xff) throw new Error(`JPEG 标记流在 0x${cursor.toString(16)} 损坏`);
      while (bytes[cursor] === 0xff) cursor += 1;
      const marker = bytes[cursor++];
      if (marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > bytes.length) throw new Error("JPEG 段长度被截断");
      const length = readU16(bytes, cursor, "be");
      if (length < 2 || cursor + length > bytes.length) throw new Error("JPEG 段负载被截断");
      const payload = bytes.subarray(cursor + 2, cursor + length);
      if (marker === 0xc2) return unsupported("渐进式 JPEG 暂不支持 DCT 系数解码", frame ? { width: frame.width, height: frame.height, components: frame.components.length } : {});
      if ([0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return unsupported("算术编码 JPEG 暂不支持 DCT 系数解码");
      if (marker === 0xdb) parseQuantizationTables(payload, quantizationTables);
      else if (marker === 0xc4) parseHuffmanTables(payload, huffmanTables);
      else if (marker === 0xc0) frame = parseFrame(payload);
      else if (marker === 0xdd) restartInterval = readU16(payload, 0, "be");
      else if (marker === 0xda) {
        if (!frame) return unsupported("SOS 之前缺少 SOF0");
        const scan = parseScan(payload, frame);
        for (const component of frame.components) {
          if (!quantizationTables.has(component.quantizationTable)) warnings.push(`分量 ${component.id} 缺少量化表 ${component.quantizationTable}`);
        }
        const decoded = decodeBaseline(bytes, cursor + length, frame, scan, huffmanTables, restartInterval, warnings);
        return {
          supported: true,
          width: frame.width,
          height: frame.height,
          components: frame.components.length,
          restartInterval,
          warnings,
          ...decoded,
        };
      }
      cursor += length;
    }
  } catch (error) {
    return unsupported(error instanceof Error ? error.message : String(error), frame ? { width: frame.width, height: frame.height, components: frame.components.length } : {});
  }
  return unsupported(frame ? "JPEG 缺少 SOS 扫描" : "JPEG 缺少 SOF0 帧");
}
