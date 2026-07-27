import { unzlibSync } from "fflate";
import { assessFlagCandidate, detectFlags } from "./flagDetector";
import { readAscii, readU16, readU32, StegoParseError } from "./stegoBinary";
import type { StegoFinding, StegoMetadataEntry } from "./stegoTypes";

export interface StegoMetadataResult {
  entries: StegoMetadataEntry[];
  findings: StegoFinding[];
}

const TIFF_TAGS: Record<number, string> = {
  0x010d: "DocumentName",
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x013c: "HostComputer",
  0x02bc: "XMP",
  0x8298: "Copyright",
  0x9003: "DateTimeOriginal",
  0x9286: "UserComment",
  0x9c9b: "XPTitle",
  0x9c9c: "XPComment",
  0x9c9d: "XPAuthor",
  0x9c9e: "XPKeywords",
  0x9c9f: "XPSubject",
  0xa434: "LensModel",
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
  if (tag >= 0x9c9b && tag <= 0x9c9f) return text(bytes, "utf-16le");
  if (tag === 0x02bc) return text(bytes);
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
        entries.push({
          group: tag === 0x02bc ? "XMP" : current.group,
          key: tag === 0x02bc ? "Packet" : TIFF_TAGS[tag] ?? `Tag 0x${tag.toString(16).padStart(4, "0")}`,
          value,
          offset: baseOffset + valueOffset,
        });
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

function parsePsd(bytes: Uint8Array, entries: StegoMetadataEntry[], findings: StegoFinding[]) {
  if (readAsciiSafe(bytes, 0, 4) !== "8BPS") return;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const start = decoded.indexOf("<?xpacket");
  if (start < 0) return;
  const endMarker = decoded.indexOf("<?xpacket end=", start);
  const close = endMarker < 0 ? -1 : decoded.indexOf("?>", endMarker);
  const packet = decoded.slice(start, close < 0 ? Math.min(decoded.length, start + 64 * 1024) : close + 2);
  entries.push({ group: "PSD XMP", key: "Packet", value: packet, offset: start });
  const history = packet.match(/<xmpMM:History>[\s\S]*?<\/xmpMM:History>/)?.[0] ?? "";
  let index = 0;
  for (const match of history.matchAll(/<stEvt:when>([^<]+)<\/stEvt:when>/g)) {
    entries.push({ group: "PSD XMP 历史", key: `When ${index + 1}`, value: match[1].trim(), offset: start + (match.index ?? 0) });
    index += 1;
  }
  if (!history) metadataFinding(findings, "PSD XMP 未包含编辑历史", "已提取 XMP，但没有找到 xmpMM:History", start);
}

function addDerivedFlag(findings: StegoFinding[], title: string, value: string, offset?: number) {
  if (findings.some((finding) => finding.detail.toLowerCase() === value.toLowerCase())) return;
  const assessment = assessFlagCandidate(value);
  findings.push({
    id: `metadata-derived-${findings.length}`,
    severity: assessment.confidence === "high" ? "high" : "suspicious",
    source: "元数据派生",
    title,
    detail: value,
    offset,
  });
}

const HOMOPHONE_TOKENS: Array<readonly [string, string]> = [
  ["豆贝尔维", "w"], ["艾克斯", "x"], ["艾尺", "h"], ["艾勒", "l"], ["艾姆", "m"], ["艾恩", "n"], ["艾丝", "s"],
  ["艾弗", "f"], ["爱抚", "f"], ["阿尔", "r"], ["贼德", "z"], ["秀", "show"],
  ["零", "0"], ["一", "1"], ["二", "2"], ["三", "3"], ["四", "4"], ["五", "5"], ["六", "6"], ["七", "7"], ["八", "8"], ["九", "9"],
  ["诶", "a"], ["必", "b"], ["比", "b"], ["西", "c"], ["弟", "d"], ["迪", "d"], ["易", "e"], ["伊", "e"],
  ["吉", "g"], ["艾", "i"], ["杰", "j"], ["开", "k"], ["哦", "o"], ["劈", "p"], ["丘", "q"], ["替", "t"],
  ["提", "t"], ["优", "u"], ["维", "v"], ["歪", "y"],
];

function chineseHomophoneCandidates(
  value: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const opening = value.indexOf("大括号");
  const closing = value.lastIndexOf("大括号");
  if (opening < 0 || closing <= opening) return [];
  let decoded = `${value.slice(0, opening)}{${value.slice(opening + 3, closing)}}${value.slice(closing + 3)}`;
  for (const [token, replacement] of HOMOPHONE_TOKENS) decoded = decoded.replaceAll(token, replacement);
  return detectFlags(decoded, prefixes, caseSensitive).map((hit) => hit.text);
}

function appendMetadataDerivations(
  entries: StegoMetadataEntry[],
  findings: StegoFinding[],
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  for (const entry of entries) {
    for (const candidate of chineseHomophoneCandidates(entry.value, prefixes, caseSensitive)) {
      addDerivedFlag(findings, "中文同音字符派生 Flag", candidate, entry.offset);
    }
  }

  const emptyPrefix = entries.map((entry) => entry.value.match(/^([A-Za-z][A-Za-z0-9_-]{1,31})\{\}$/)?.[1]).find(Boolean);
  if (emptyPrefix) {
    const values = entries.flatMap((entry) => {
      const match = entry.value.match(/^(\d+)(?:\s+\(\1\/1\))?$/);
      if (!match) return [];
      const value = Number.parseInt(match[1], 10);
      return Number.isSafeInteger(value) && value >= 0x01000000 && value <= 0xffffffff ? [value] : [];
    });
    if (values.length >= 2 && values.length <= 16) {
      const payload = values.map((value) => value.toString(16).padStart(8, "0")).join("");
      addDerivedFlag(findings, "EXIF 十进制转十六进制 Flag", `${emptyPrefix}{${payload}}`);
    }
  }

  for (const entry of entries.filter((item) => item.group === "PSD XMP" && item.key === "Packet")) {
    if (!entry.value.includes("UnixTimestamp") || !entry.value.includes("DECtoHEX")) continue;
    const prefix = entry.value.match(/([A-Za-z][A-Za-z0-9_-]{1,31})\{\}/)?.[1];
    const history = entry.value.match(/<xmpMM:History>[\s\S]*?<\/xmpMM:History>/)?.[0] ?? "";
    const timestamps = Array.from(history.matchAll(/<stEvt:when>([^<]+)<\/stEvt:when>/g), (match) => {
      const normalized = match[1].trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
      return Math.floor(Date.parse(normalized) / 1000);
    }).filter((value) => Number.isFinite(value) && value >= 0 && value <= 0xffffffff);
    if (prefix && timestamps.length >= 2 && timestamps.length <= 16) {
      const payload = timestamps.map((value) => value.toString(16).padStart(8, "0")).join("");
      addDerivedFlag(findings, "PSD XMP 时间戳派生 Flag", `${prefix}{${payload}}`, entry.offset);
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendMetadataFlags(
  entries: StegoMetadataEntry[],
  findings: StegoFinding[],
  prefixes: readonly string[],
  caseSensitive: boolean,
) {
  const cleanPrefixes = prefixes.map((prefix) => prefix.trim()).filter(Boolean);
  if (cleanPrefixes.length === 0) return;
  const seen = new Set<string>();
  const addFinding = (title: string, value: string, offset?: number) => {
    const key = caseSensitive ? value : value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const assessment = assessFlagCandidate(value);
    findings.push({
      id: `metadata-flag-${findings.length}`,
      severity: assessment.confidence === "high" ? "high" : "suspicious",
      source: "元数据",
      title,
      detail: value,
      offset,
    });
  };

  for (const entry of entries) {
    for (const hit of detectFlags(entry.value, cleanPrefixes, caseSensitive)) {
      addFinding("元数据发现 Flag", hit.text, entry.offset);
    }
  }

  const prefixPattern = cleanPrefixes.map(escapeRegExp).sort((left, right) => right.length - left.length).join("|");
  const starts: Array<{ value: string; offset?: number }> = [];
  const endings: string[] = [];
  const middle: string[] = [];
  const startExpression = new RegExp(`(?:${prefixPattern})\\{[A-Za-z0-9_+./=-]{1,64}`, caseSensitive ? "g" : "gi");
  const endingExpression = /[A-Za-z0-9_+./=-]{2,64}\}/g;
  for (const entry of entries) {
    for (const match of entry.value.match(startExpression) ?? []) {
      const start = entry.value.indexOf(match);
      if (start >= 0 && entry.value.indexOf("}", start + match.length) < 0) starts.push({ value: match, offset: entry.offset });
    }
    for (const match of entry.value.match(endingExpression) ?? []) endings.push(match);
    const candidate = entry.value.trim();
    if (/^[0-9a-f]{4,64}$/i.test(candidate)) middle.push(candidate);
  }
  const unique = (values: string[]) => values.filter((value, index) =>
    values.findIndex((candidate) => caseSensitive ? candidate === value : candidate.toLowerCase() === value.toLowerCase()) === index,
  );
  const middleValues = unique(middle).slice(0, 24);
  const endingValues = unique(endings).slice(0, 24);
  const combinationStart = findings.length;

  for (const start of starts.slice(0, 16)) {
    const opening = start.value.indexOf("{");
    const first = start.value.slice(opening + 1);
    for (const ending of endingValues) {
      const last = ending.slice(0, -1);
      const combinations: string[][] = [];
      const visit = (from: number, selected: string[]) => {
        if (combinations.length >= 64 || selected.length > 4) return;
        combinations.push(selected);
        if (selected.length === 4) return;
        for (let index = from; index < middleValues.length; index += 1) {
          const value = middleValues[index];
          if (first.length + selected.join("").length + value.length + last.length <= 512) visit(index + 1, [...selected, value]);
        }
      };
      visit(0, []);
      for (const parts of combinations) {
        const value = `${start.value}${parts.join("")}${ending}`;
        if (detectFlags(value, cleanPrefixes, caseSensitive).some((hit) => caseSensitive ? hit.text === value : hit.text.toLowerCase() === value.toLowerCase())) {
          addFinding("元数据组合发现 Flag", value, start.offset);
        }
      }
    }
  }
  const combinationFindings = findings.slice(combinationStart)
    .filter((finding) => finding.title === "元数据组合发现 Flag");
  const completeHex = combinationFindings.filter((finding) =>
    /^[A-Za-z][A-Za-z0-9_-]{1,31}\{[0-9a-fA-F]{32}\}$/.test(finding.detail),
  );
  if (completeHex.length > 0) {
    for (const finding of combinationFindings) {
      if (!completeHex.includes(finding)) finding.severity = "suspicious";
    }
  }
}

export function extractStegoMetadata(
  bytes: Uint8Array,
  options: { prefixes?: readonly string[]; caseSensitive?: boolean } = {},
): StegoMetadataResult {
  const entries: StegoMetadataEntry[] = [];
  const findings: StegoFinding[] = [];
  const prefixes = options.prefixes ?? ["flag", "ctf", "ctfshow"];
  const caseSensitive = options.caseSensitive ?? false;
  if (readAsciiSafe(bytes, 1, 3) === "PNG") parsePng(bytes, entries, findings);
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) parseJpeg(bytes, entries, findings);
  else if (readAsciiSafe(bytes, 0, 4) === "RIFF" && readAsciiSafe(bytes, 8, 4) === "WEBP") parseWebp(bytes, entries, findings);
  else if ((readAsciiSafe(bytes, 0, 4) === "II*\0") || (readAsciiSafe(bytes, 0, 4) === "MM\0*")) parseTiff(bytes, 0, entries, findings);
  else if (readAsciiSafe(bytes, 0, 4) === "8BPS") parsePsd(bytes, entries, findings);
  appendMetadataDerivations(entries, findings, prefixes, caseSensitive);
  appendMetadataFlags(entries, findings, prefixes, caseSensitive);
  return { entries, findings };
}
