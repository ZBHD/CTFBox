import { unzlibSync } from "fflate";
import { readAscii, readU16, readU32, StegoParseError } from "./stegoBinary";
import type { StegoFinding, StegoMetadataEntry } from "./stegoTypes";

export interface StegoMetadataResult {
  entries: StegoMetadataEntry[];
  findings: StegoFinding[];
}

const TIFF_TAGS: Record<number, string> = {
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x8298: "Copyright",
  0x9003: "DateTimeOriginal",
  0x9286: "UserComment",
  0x9c9c: "XPComment",
  0x0001: "GPSLatitudeRef",
  0x0002: "GPSLatitude",
  0x0003: "GPSLongitudeRef",
  0x0004: "GPSLongitude",
};

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function text(bytes: Uint8Array, encoding = "utf-8") {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes).replace(/\0+$/g, "").trim();
}

function findNull(bytes: Uint8Array, start = 0) {
  const index = bytes.indexOf(0, start);
  return index < 0 ? bytes.length : index;
}

function metadataFinding(findings: StegoFinding[], title: string, detail: string, offset?: number) {
  findings.push({ id: `metadata-${findings.length}-${offset ?? "none"}`, severity: "suspicious", source: "元数据", title, detail, offset });
}

function decodeTiffValue(bytes: Uint8Array, type: number, count: number, order: "le" | "be", tag: number) {
  if (type === 2) return text(bytes);
  if (tag === 0x9c9c) return text(bytes, "utf-16le");
  if (type === 1 || type === 7) {
    const readable = text(bytes);
    return readable && Array.from(readable).every((character) => character >= " " || character === "\t") ? readable : Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(" ");
  }
  const values: string[] = [];
  const limit = Math.min(count, 32);
  for (let index = 0; index < limit; index += 1) {
    if (type === 3) values.push(String(readU16(bytes, index * 2, order)));
    else if (type === 4) values.push(String(readU32(bytes, index * 4, order)));
    else if (type === 9) {
      const value = readU32(bytes, index * 4, order);
      values.push(String(value > 0x7fffffff ? value - 0x100000000 : value));
    } else if (type === 5 || type === 10) {
      const numeratorRaw = readU32(bytes, index * 8, order);
      const denominatorRaw = readU32(bytes, index * 8 + 4, order);
      const numerator = type === 10 && numeratorRaw > 0x7fffffff ? numeratorRaw - 0x100000000 : numeratorRaw;
      const denominator = type === 10 && denominatorRaw > 0x7fffffff ? denominatorRaw - 0x100000000 : denominatorRaw;
      values.push(denominator === 0 ? `${numerator}/0` : `${numerator / denominator} (${numerator}/${denominator})`);
    }
  }
  if (count > limit) values.push(`... 共 ${count} 项`);
  return values.join(", ");
}

function parseTiff(tiff: Uint8Array, baseOffset: number, entries: StegoMetadataEntry[], findings: StegoFinding[]) {
  try {
    const signature = readAscii(tiff, 0, 2);
    const order = signature === "II" ? "le" : signature === "MM" ? "be" : undefined;
    if (!order || readU16(tiff, 2, order) !== 42) throw new StegoParseError("TIFF 头无效", 0);
    const queue: Array<{ offset: number; group: string; depth: number }> = [{ offset: readU32(tiff, 4, order), group: "EXIF", depth: 0 }];
    const visited = new Set<number>();
    let totalEntries = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > 8 || visited.has(current.offset)) continue;
      visited.add(current.offset);
      const count = readU16(tiff, current.offset, order);
      if (count > 1024 || totalEntries + count > 4096) throw new StegoParseError("TIFF IFD 条目超过限制", current.offset);
      totalEntries += count;
      for (let index = 0; index < count; index += 1) {
        const entryOffset = current.offset + 2 + index * 12;
        const tag = readU16(tiff, entryOffset, order);
        const type = readU16(tiff, entryOffset + 2, order);
        const valueCount = readU32(tiff, entryOffset + 4, order);
        const size = TYPE_SIZES[type];
        if (!size || valueCount > 1_000_000) continue;
        const byteLength = size * valueCount;
        const valueOffset = byteLength <= 4 ? entryOffset + 8 : readU32(tiff, entryOffset + 8, order);
        if (valueOffset + byteLength > tiff.length) throw new StegoParseError(`TIFF 标签 0x${tag.toString(16)} 的值越界`, valueOffset);
        if (tag === 0x8769 || tag === 0x8825 || tag === 0xa005) {
          queue.push({ offset: readU32(tiff, entryOffset + 8, order), group: tag === 0x8825 ? "GPS" : "EXIF", depth: current.depth + 1 });
          continue;
        }
        const valueBytes = tiff.subarray(valueOffset, valueOffset + byteLength);
        const value = decodeTiffValue(valueBytes, type, valueCount, order, tag);
        if (!value) continue;
        entries.push({ group: current.group, key: TIFF_TAGS[tag] ?? `Tag 0x${tag.toString(16).padStart(4, "0")}`, value, offset: baseOffset + entryOffset });
      }
      const nextOffsetPosition = current.offset + 2 + count * 12;
      const next = readU32(tiff, nextOffsetPosition, order);
      if (next !== 0) queue.push({ offset: next, group: current.group, depth: current.depth + 1 });
    }
  } catch (error) {
    metadataFinding(findings, "EXIF/TIFF 结构异常", error instanceof Error ? error.message : String(error), baseOffset);
  }
}

function parsePng(bytes: Uint8Array, entries: StegoMetadataEntry[], findings: StegoFinding[]) {
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = readU32(bytes, cursor, "be");
    const type = readAscii(bytes, cursor + 4, 4);
    const dataStart = cursor + 8;
    const end = dataStart + length;
    if (end + 4 > bytes.length) break;
    const data = bytes.subarray(dataStart, end);
    try {
      if (type === "tEXt") {
        const split = findNull(data);
        entries.push({ group: "PNG 文本", key: text(data.subarray(0, split)), value: text(data.subarray(split + 1)), offset: dataStart });
      } else if (type === "zTXt") {
        const split = findNull(data);
        if (data[split + 1] !== 0) throw new Error("不支持的 zTXt 压缩方法");
        entries.push({ group: "PNG 文本", key: text(data.subarray(0, split)), value: text(unzlibSync(data.subarray(split + 2))), offset: dataStart });
      } else if (type === "iTXt") {
        const keywordEnd = findNull(data);
        const compressed = data[keywordEnd + 1] === 1;
        let position = keywordEnd + 3;
        const languageEnd = findNull(data, position);
        const language = text(data.subarray(position, languageEnd));
        position = languageEnd + 1;
        const translatedEnd = findNull(data, position);
        position = translatedEnd + 1;
        const valueBytes = compressed ? unzlibSync(data.subarray(position)) : data.subarray(position);
        entries.push({ group: "PNG iTXt", key: text(data.subarray(0, keywordEnd)), value: text(valueBytes), offset: dataStart });
        if (language) entries.push({ group: "PNG iTXt", key: "Language", value: language, offset: dataStart });
      } else if (type === "eXIf") parseTiff(data, dataStart, entries, findings);
      else if (type === "iCCP") entries.push({ group: "ICC", key: "PNG Profile", value: text(data.subarray(0, findNull(data))), offset: dataStart });
      else if (type[1] === type[1]?.toLowerCase() && type !== "IDAT") entries.push({ group: "PNG 私有块", key: type, value: `${length} 字节`, offset: cursor });
    } catch (error) {
      metadataFinding(findings, `${type} 元数据解析失败`, error instanceof Error ? error.message : String(error), cursor);
    }
    cursor = end + 4;
    if (type === "IEND") break;
  }
}

function parseJpeg(bytes: Uint8Array, entries: StegoMetadataEntry[], findings: StegoFinding[]) {
  let cursor = 2;
  while (cursor + 3 < bytes.length && bytes[cursor] === 0xff) {
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    try {
      const length = readU16(bytes, cursor, "be");
      if (length < 2 || cursor + length > bytes.length) throw new StegoParseError("JPEG APP 段被截断", cursor - 2);
      const dataStart = cursor + 2;
      const data = bytes.subarray(dataStart, cursor + length);
      if (marker === 0xe1 && readAsciiSafe(data, 0, 6) === "Exif\0\0") parseTiff(data.subarray(6), dataStart + 6, entries, findings);
      else if (marker === 0xe1 && text(data.subarray(0, Math.min(data.length, 64))).startsWith("http://ns.adobe.com/xap/1.0/")) {
        const split = findNull(data);
        entries.push({ group: "XMP", key: "Packet", value: text(data.subarray(split + 1)), offset: dataStart + split + 1 });
      } else if (marker === 0xe2 && readAsciiSafe(data, 0, 12) === "ICC_PROFILE\0") {
        entries.push({ group: "ICC", key: "JPEG Profile", value: `第 ${data[12]}/${data[13]} 段，${Math.max(0, data.length - 14)} 字节`, offset: dataStart });
      } else if (marker === 0xed) entries.push({ group: "Photoshop", key: "APP13", value: text(data).slice(0, 4096) || `${data.length} 字节`, offset: dataStart });
      else if (marker === 0xfe) entries.push({ group: "JPEG", key: "Comment", value: text(data), offset: dataStart });
      cursor += length;
    } catch (error) {
      metadataFinding(findings, "JPEG 元数据段异常", error instanceof Error ? error.message : String(error), cursor - 2);
      break;
    }
  }
}

function readAsciiSafe(bytes: Uint8Array, offset: number, length: number) {
  return offset + length <= bytes.length ? readAscii(bytes, offset, length) : "";
}

function parseWebp(bytes: Uint8Array, entries: StegoMetadataEntry[], findings: StegoFinding[]) {
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const type = readAscii(bytes, cursor, 4);
    const length = readU32(bytes, cursor + 4, "le");
    const dataStart = cursor + 8;
    if (dataStart + length > bytes.length) {
      metadataFinding(findings, "WebP 块被截断", `${type} 声明 ${length} 字节`, cursor);
      break;
    }
    const data = bytes.subarray(dataStart, dataStart + length);
    if (type === "EXIF") parseTiff(readAsciiSafe(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data, dataStart, entries, findings);
    else if (type === "XMP ") entries.push({ group: "XMP", key: "Packet", value: text(data), offset: dataStart });
    else if (type === "ICCP") entries.push({ group: "ICC", key: "WebP Profile", value: `${length} 字节`, offset: dataStart });
    cursor = dataStart + length + (length & 1);
  }
}

export function extractStegoMetadata(bytes: Uint8Array): StegoMetadataResult {
  const entries: StegoMetadataEntry[] = [];
  const findings: StegoFinding[] = [];
  if (readAsciiSafe(bytes, 1, 3) === "PNG") parsePng(bytes, entries, findings);
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) parseJpeg(bytes, entries, findings);
  else if (readAsciiSafe(bytes, 0, 4) === "RIFF" && readAsciiSafe(bytes, 8, 4) === "WEBP") parseWebp(bytes, entries, findings);
  return { entries, findings };
}
