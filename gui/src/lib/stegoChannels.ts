import { assessFlagCandidate, detectFlags } from "./flagDetector";
import { crc32, readAscii, readU16, readU32 } from "./stegoBinary";
import { analyzeByteRecipes } from "./stegoByteRecipes";
import { decodeFiveBySevenVisual } from "./stegoDotMatrix";
import type { StegoChannelCandidate, StegoFinding, StegoVisual } from "./stegoTypes";

export interface StegoChannelResult {
  candidates: StegoChannelCandidate[];
  visuals: StegoVisual[];
  findings: StegoFinding[];
}

interface PngChunk {
  type: string;
  data: Uint8Array;
  length: number;
  offset: number;
  storedCrc: number;
  actualCrc: number;
}

interface GifFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  delay: number;
}

interface JpegSegment {
  marker: number;
  payload: Uint8Array;
  offset: number;
  fillLength: number;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function probableFlags(value: string) {
  return Array.from(value.matchAll(/(?:^|[^A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]{1,31}\{[^\x00-\x1f{}]{1,512}\})/g), (match) => match[1]);
}

function flagsIn(value: string, prefixes: readonly string[], caseSensitive: boolean) {
  return [...new Set([
    ...detectFlags(value, prefixes, caseSensitive).map((hit) => hit.text),
    ...probableFlags(value),
  ])];
}

function addCandidate(
  candidates: StegoChannelCandidate[],
  source: string,
  label: string,
  value: string,
  detail: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const normalized = value.replace(/^\.+/, "").replace(/\0+$/g, "").trim();
  if (normalized.length < 4 || candidates.some((candidate) => candidate.source === source && candidate.value === normalized)) return;
  const flags = flagsIn(normalized, prefixes, caseSensitive);
  const confidence = flags.some((flag) => assessFlagCandidate(flag).confidence === "high") ? "high" : "candidate";
  candidates.push({ id: `channel-${candidates.length}`, source, label, value: normalized, confidence, detail, flags });
}

function addByteCandidates(
  candidates: StegoChannelCandidate[],
  source: string,
  label: string,
  bytes: Uint8Array,
  detail: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  if (bytes.length === 0) return;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  for (const flag of flagsIn(decoded, prefixes, caseSensitive)) addCandidate(candidates, source, label, flag, detail, prefixes, caseSensitive);
  let start = -1;
  for (let index = 0; index <= bytes.length; index += 1) {
    const byte = bytes[index];
    const printable = byte >= 32 && byte <= 126;
    if (printable && start < 0) start = index;
    if (!printable && start >= 0) {
      const value = String.fromCharCode(...bytes.subarray(start, index));
      if (value.length >= 6) addCandidate(candidates, source, label, value, detail, prefixes, caseSensitive);
      start = -1;
    }
  }
}

function parsePngChunks(bytes: Uint8Array) {
  const chunks: PngChunk[] = [];
  let cursor = 8;
  while (cursor + 12 <= bytes.length && chunks.length < 100_000) {
    const length = readU32(bytes, cursor, "be");
    const dataStart = cursor + 8;
    const end = dataStart + length;
    if (end + 4 > bytes.length) break;
    const type = readAscii(bytes, cursor + 4, 4);
    const data = bytes.subarray(dataStart, end);
    chunks.push({
      type,
      data,
      length,
      offset: cursor,
      storedCrc: readU32(bytes, end, "be"),
      actualCrc: crc32(bytes.subarray(cursor + 4, end)),
    });
    cursor = end + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

function u32Bytes(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function decodeBitVariants(
  bits: string,
  candidates: StegoChannelCandidate[],
  source: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  for (const inverted of [false, true]) {
    const stream = inverted ? bits.replace(/[01]/g, (bit) => bit === "0" ? "1" : "0") : bits;
    for (const width of [7, 8]) {
      for (let alignment = 0; alignment < width; alignment += 1) {
        const values: number[] = [];
        for (let cursor = alignment; cursor + width <= stream.length; cursor += width) values.push(Number.parseInt(stream.slice(cursor, cursor + width), 2));
        addByteCandidates(
          candidates,
          source,
          `${width} 位${inverted ? "反相" : "正相"}，偏移 ${alignment}`,
          Uint8Array.from(values),
          `位宽 ${width}，位偏移 ${alignment}，${inverted ? "0/1 已反相" : "低值记 0、高值记 1"}`,
          prefixes,
          caseSensitive,
        );
      }
    }
  }
}

function scatterVisual(id: string, label: string, coordinates: Array<[number, number]>) {
  const maximumX = Math.max(...coordinates.map(([x]) => x));
  const maximumY = Math.max(...coordinates.map(([, y]) => y));
  const scale = Math.max(1, Math.ceil(Math.max(maximumX + 1, maximumY + 1) / 1024));
  const width = Math.max(1, Math.floor(maximumX / scale) + 1);
  const height = Math.max(1, Math.floor(maximumY / scale) + 1);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
    pixels[index + 3] = 255;
  }
  for (const [x, y] of coordinates) {
    const pixel = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
    pixels[pixel] = 0;
    pixels[pixel + 1] = 0;
    pixels[pixel + 2] = 0;
  }
  return { id, label, width, height, pixels, detail: `${coordinates.length} 个坐标点；缩放 1:${scale}` } satisfies StegoVisual;
}

function analyzePng(
  bytes: Uint8Array,
  candidates: StegoChannelCandidate[],
  visuals: StegoVisual[],
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const chunks = parsePngChunks(bytes);
  const idatLengths = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.length <= 255 ? chunk.length : 0);
  addByteCandidates(candidates, "PNG IDAT 长度", "连续块长度按 ASCII 解码", Uint8Array.from(idatLengths), `${idatLengths.length} 个 IDAT 块`, prefixes, caseSensitive);

  const bad = chunks.filter((chunk) => chunk.storedCrc !== chunk.actualCrc);
  if (bad.length > 0) {
    const stored = new Uint8Array(bad.length * 4);
    const expected = new Uint8Array(bad.length * 4);
    const xor = new Uint8Array(bad.length * 4);
    bad.forEach((chunk, index) => {
      stored.set(u32Bytes(chunk.storedCrc), index * 4);
      expected.set(u32Bytes(chunk.actualCrc), index * 4);
      for (let byte = 0; byte < 4; byte += 1) xor[index * 4 + byte] = stored[index * 4 + byte] ^ expected[index * 4 + byte];
    });
    addByteCandidates(candidates, "PNG 错误 CRC", "记录 CRC 字节", stored, `${bad.length} 个 CRC 异常块`, prefixes, caseSensitive);
    addByteCandidates(candidates, "PNG 错误 CRC", "正确 CRC 字节", expected, `${bad.length} 个 CRC 异常块`, prefixes, caseSensitive);
    addByteCandidates(candidates, "PNG 错误 CRC", "记录值 XOR 正确值", xor, `${bad.length} 个 CRC 异常块`, prefixes, caseSensitive);
  }
  if (chunks.length >= 9) decodeBitVariants(chunks.map((chunk) => chunk.storedCrc === chunk.actualCrc ? "1" : "0").join(""), candidates, "PNG CRC 正误", prefixes, caseSensitive);

  const frameControls = chunks.filter((chunk) => chunk.type === "fcTL" && chunk.data.length === 26).map((chunk) => ({
    delay: readU16(chunk.data, 20, "be"),
    x: readU32(chunk.data, 12, "be"),
    y: readU32(chunk.data, 16, "be"),
  }));
  if (frameControls.length > 0) {
    addByteCandidates(candidates, "APNG fcTL delay_num", "帧延时分子按字节解码", Uint8Array.from(frameControls.map((frame) => frame.delay <= 255 ? frame.delay : 0)), `${frameControls.length} 个 fcTL 块`, prefixes, caseSensitive);
    const coordinates = frameControls.map((frame) => [frame.x, frame.y] as [number, number]);
    if (new Set(coordinates.map(([x, y]) => `${x}:${y}`)).size >= 4) visuals.push(scatterVisual("apng-offset-scatter", "APNG 帧偏移坐标", coordinates));
  }
}

function skipGifSubBlocks(bytes: Uint8Array, start: number) {
  let cursor = start;
  while (cursor < bytes.length) {
    const length = bytes[cursor++];
    if (length === 0) return cursor;
    if (cursor + length > bytes.length) return bytes.length;
    cursor += length;
  }
  return cursor;
}

function parseGifFrames(bytes: Uint8Array) {
  const frames: GifFrame[] = [];
  if (bytes.length < 13) return frames;
  let cursor = 13;
  if ((bytes[10] & 0x80) !== 0) cursor += 3 * (1 << ((bytes[10] & 7) + 1));
  let delay = 0;
  while (cursor < bytes.length && frames.length < 100_000) {
    const introducer = bytes[cursor++];
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      const label = bytes[cursor++];
      if (label === 0xf9 && bytes[cursor] === 4 && cursor + 6 <= bytes.length) {
        delay = readU16(bytes, cursor + 2, "le");
        cursor += 6;
      } else cursor = skipGifSubBlocks(bytes, cursor);
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
    cursor += 1;
    cursor = skipGifSubBlocks(bytes, cursor);
    frames.push({ left, top, width, height, delay });
    delay = 0;
  }
  return frames;
}

function analyzeGif(
  bytes: Uint8Array,
  candidates: StegoChannelCandidate[],
  visuals: StegoVisual[],
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const frames = parseGifFrames(bytes);
  const delays = [...new Set(frames.map((frame) => frame.delay))].sort((left, right) => left - right);
  if (delays.length === 2 && frames.length >= 14) {
    const bits = frames.map((frame) => frame.delay === delays[0] ? "0" : "1").join("");
    decodeBitVariants(bits, candidates, "GIF 帧延时", prefixes, caseSensitive);
  }
  const coordinates = frames.map((frame) => [frame.left, frame.top] as [number, number]);
  if (new Set(coordinates.map(([x, y]) => `${x}:${y}`)).size >= 4) visuals.push(scatterVisual("gif-offset-scatter", "GIF 帧偏移坐标", coordinates));
}

function parseJpegSegments(bytes: Uint8Array) {
  const segments: JpegSegment[] = [];
  let cursor = 2;
  while (cursor < bytes.length && segments.length < 100_000) {
    if (bytes[cursor] !== 0xff) break;
    const offset = cursor;
    while (bytes[cursor] === 0xff) cursor += 1;
    const fillLength = cursor - offset;
    const marker = bytes[cursor++];
    if (marker === undefined || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, payload: new Uint8Array(), offset, fillLength });
      continue;
    }
    if (cursor + 2 > bytes.length) break;
    const length = readU16(bytes, cursor, "be");
    if (length < 2 || cursor + length > bytes.length) break;
    const payload = bytes.subarray(cursor + 2, cursor + length);
    segments.push({ marker, payload, offset, fillLength });
    cursor += length;
    if (marker === 0xda) break;
  }
  return segments;
}

function jpegQuantizationValues(segments: JpegSegment[]) {
  const tables: Array<{ id: number; values: Uint8Array }> = [];
  for (const segment of segments.filter((item) => item.marker === 0xdb)) {
    let cursor = 0;
    while (cursor < segment.payload.length) {
      const specification = segment.payload[cursor++];
      const precision = specification >>> 4;
      const id = specification & 0x0f;
      const byteLength = precision === 0 ? 64 : precision === 1 ? 128 : 0;
      if (byteLength === 0 || cursor + byteLength > segment.payload.length) break;
      if (precision === 0) tables.push({ id, values: segment.payload.slice(cursor, cursor + 64) });
      else {
        const values = new Uint8Array(64);
        for (let index = 0; index < 64; index += 1) values[index] = readU16(segment.payload, cursor + index * 2, "be") & 0xff;
        tables.push({ id, values });
      }
      cursor += byteLength;
    }
  }
  return tables;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ffRunLengths(bytes: Uint8Array) {
  const runs: number[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (bytes[cursor] === 0xff) cursor += 1;
    runs.push(cursor - start);
    if (cursor < bytes.length) cursor += 1;
  }
  return runs;
}

function analyzeJpeg(
  bytes: Uint8Array,
  candidates: StegoChannelCandidate[],
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const segments = parseJpegSegments(bytes);
  const tables = jpegQuantizationValues(segments);
  for (const table of tables) {
    addByteCandidates(candidates, "JPEG DQT 数据", `量化表 ${table.id} 原始值`, table.values, "直接检查量化表值中的可读负载", prefixes, caseSensitive);
  }
  if (tables.length > 0) {
    const parityBits = tables.flatMap((table) => Array.from(table.values, (value) => String(value & 1))).join("");
    decodeBitVariants(parityBits, candidates, "JPEG DQT 奇偶", prefixes, caseSensitive);
  }

  const cleanPrefixes = prefixes.map((prefix) => prefix.trim()).filter(Boolean);
  const decoded = new TextDecoder("iso-8859-1", { fatal: false }).decode(bytes);
  const hints: Array<{ prefix: string; count: number }> = [];
  for (const prefix of cleanPrefixes) {
    const expression = new RegExp(`${escapeRegExp(prefix)}\\{(\\d{1,3})\}`, caseSensitive ? "g" : "gi");
    for (const match of decoded.matchAll(expression)) {
      const count = Number.parseInt(match[1], 10);
      if (count >= 4 && count <= 256) hints.push({ prefix: match[0].slice(0, match[0].indexOf("{")), count });
    }
  }
  const runs = ffRunLengths(bytes);
  for (const hint of hints) {
    const selected = runs.slice(0, hint.count);
    if (selected.length !== hint.count || selected.some((length) => length < 1 || length > 16)) continue;
    const value = `${hint.prefix}{${selected.map((length) => (length - 1).toString(16)).join("")}}`;
    addCandidate(candidates, "JPEG FF 游程", "连续 FF 数量减一", value, `按文件顺序读取前 ${hint.count} 个 FF 游程，每个长度减一后作为十六进制半字节`, prefixes, caseSensitive);
  }

  const appSegments = segments.filter((segment) => segment.marker >= 0xe0 && segment.marker <= 0xef);
  if (appSegments.length >= 8 && appSegments.length <= 128) {
    const payload = appSegments.map((segment) => (segment.marker & 0x0f).toString(16)).join("");
    for (const prefix of cleanPrefixes) {
      addCandidate(candidates, "JPEG APP 标记", "APPn 低半字节", `${prefix}{${payload}}`, `按出现顺序读取 ${appSegments.length} 个 APPn 标记的 n（包括可能存在的标准 JFIF APP0）`, prefixes, caseSensitive);
    }
  }
}

export function analyzeStegoChannels(bytes: Uint8Array, prefixes: readonly string[], caseSensitive: boolean): StegoChannelResult {
  const candidates: StegoChannelCandidate[] = [];
  const visuals: StegoVisual[] = [];
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) analyzePng(bytes, candidates, visuals, prefixes, caseSensitive);
  else if (startsWith(bytes, [0xff, 0xd8])) analyzeJpeg(bytes, candidates, prefixes, caseSensitive);
  else if (readAscii(bytes, 0, Math.min(6, bytes.length)) === "GIF87a" || readAscii(bytes, 0, Math.min(6, bytes.length)) === "GIF89a") analyzeGif(bytes, candidates, visuals, prefixes, caseSensitive);
  const recipes = analyzeByteRecipes(bytes, prefixes, caseSensitive);
  candidates.push(...recipes.candidates);
  visuals.push(...recipes.visuals);
  for (const visual of visuals.filter((item) => item.id.endsWith("-offset-scatter"))) {
    for (const decoded of decodeFiveBySevenVisual(visual)) {
      addCandidate(candidates, "坐标点阵", visual.label, decoded.text, decoded.detail, prefixes, caseSensitive);
    }
  }
  candidates.sort((left, right) => (left.confidence === "high" ? 0 : 1) - (right.confidence === "high" ? 0 : 1) || left.source.localeCompare(right.source) || left.value.localeCompare(right.value));
  const findings: StegoFinding[] = [];
  for (const candidate of candidates) {
    for (const flag of candidate.flags) {
      if (findings.some((finding) => finding.detail === flag)) continue;
      const assessment = assessFlagCandidate(flag);
      findings.push({
        id: `channel-flag-${findings.length}`,
        severity: assessment.confidence === "high" ? "high" : "suspicious",
        source: candidate.source,
        title: assessment.confidence === "high" ? "结构信道发现 Flag" : "结构信道疑似 Flag",
        detail: flag,
      });
    }
  }
  if (candidates.length > 0 && findings.length === 0) findings.push({ id: "channel-candidates", severity: "info", source: "结构信道", title: "发现可读结构信道候选", detail: `${candidates.length} 个候选，需结合题干确认位宽、极性或字段顺序` });
  findings.push(...recipes.findings.filter((finding) => !findings.some((existing) => existing.detail === finding.detail)));
  return { candidates: candidates.slice(0, 200), visuals, findings };
}
