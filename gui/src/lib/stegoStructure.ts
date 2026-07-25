import { findEmbeddedFiles } from "./lsbFormats";
import { crc32, hexPreview, readAscii, readU16, readU32, shannonEntropy, StegoParseError } from "./stegoBinary";
import type { LsbExtractedFile } from "./lsbTypes";
import type { StegoFinding, StegoSection } from "./stegoTypes";

export interface StegoStructureResult {
  format: string;
  sections: StegoSection[];
  findings: StegoFinding[];
  carvedFiles: LsbExtractedFile[];
  logicalEnd?: number;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function finding(findings: StegoFinding[], severity: StegoFinding["severity"], title: string, detail: string, offset?: number) {
  findings.push({ id: `structure-${findings.length}-${offset ?? "none"}`, severity, source: "结构", title, detail, offset });
}

function parsePng(bytes: Uint8Array, sections: StegoSection[], findings: StegoFinding[]) {
  let cursor = 8;
  while (cursor < bytes.length) {
    try {
      const length = readU32(bytes, cursor, "be");
      const type = readAscii(bytes, cursor + 4, 4);
      const end = cursor + 12 + length;
      if (end > bytes.length) throw new StegoParseError(`${type} 块被截断`, cursor);
      const expected = readU32(bytes, cursor + 8 + length, "be");
      const actual = crc32(bytes.subarray(cursor + 4, cursor + 8 + length));
      const valid = expected === actual;
      sections.push({ type: "png-chunk", name: type, offset: cursor, length: end - cursor, status: valid ? "ok" : "error", detail: valid ? `数据 ${length} 字节，CRC 正常` : `数据 ${length} 字节，CRC ${expected.toString(16).padStart(8, "0")} != ${actual.toString(16).padStart(8, "0")}` });
      if (!valid) finding(findings, "suspicious", `${type} 块 CRC 异常`, `记录值 0x${expected.toString(16)}，计算值 0x${actual.toString(16)}`, cursor);
      cursor = end;
      if (type === "IEND") return cursor;
    } catch (error) {
      finding(findings, "high", "PNG 结构被截断", error instanceof Error ? error.message : String(error), cursor);
      return undefined;
    }
  }
  finding(findings, "high", "PNG 缺少 IEND", "没有找到规范结束块", cursor);
  return undefined;
}

function markerName(marker: number) {
  if (marker === 0xda) return "SOS";
  if (marker === 0xd9) return "EOI";
  if (marker === 0xdb) return "DQT";
  if (marker === 0xc4) return "DHT";
  if (marker === 0xc0) return "SOF0";
  if (marker === 0xc2) return "SOF2";
  if (marker === 0xdd) return "DRI";
  if (marker === 0xfe) return "COM";
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  return `FF${marker.toString(16).toUpperCase().padStart(2, "0")}`;
}

function parseJpeg(bytes: Uint8Array, sections: StegoSection[], findings: StegoFinding[]) {
  let cursor = 2;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      finding(findings, "high", "JPEG 标记流损坏", "标记必须以 FF 开始", cursor);
      return undefined;
    }
    const markerOffset = cursor;
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor++];
    if (marker === undefined) break;
    if (marker === 0xd9) {
      sections.push({ type: "jpeg-marker", name: "EOI", offset: markerOffset, length: cursor - markerOffset, status: "ok" });
      return cursor;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      sections.push({ type: "jpeg-marker", name: markerName(marker), offset: markerOffset, length: cursor - markerOffset, status: "ok" });
      continue;
    }
    try {
      const segmentLength = readU16(bytes, cursor, "be");
      if (segmentLength < 2 || cursor + segmentLength > bytes.length) throw new StegoParseError(`${markerName(marker)} 段被截断`, markerOffset);
      const segmentEnd = cursor + segmentLength;
      sections.push({ type: "jpeg-marker", name: markerName(marker), offset: markerOffset, length: segmentEnd - markerOffset, status: "ok", detail: `${segmentLength - 2} 字节负载` });
      cursor = segmentEnd;
      if (marker !== 0xda) continue;
      while (cursor + 1 < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          cursor += 1;
          continue;
        }
        let next = cursor + 1;
        while (bytes[next] === 0xff) next += 1;
        const code = bytes[next];
        if (code === 0x00) {
          cursor = next + 1;
          continue;
        }
        if (code >= 0xd0 && code <= 0xd7) {
          cursor = next + 1;
          continue;
        }
        cursor = cursor;
        break;
      }
    } catch (error) {
      finding(findings, "high", "JPEG 段被截断", error instanceof Error ? error.message : String(error), markerOffset);
      return undefined;
    }
  }
  finding(findings, "high", "JPEG 缺少 EOI", "没有找到规范结束标记", cursor);
  return undefined;
}

function skipGifSubBlocks(bytes: Uint8Array, start: number) {
  let cursor = start;
  while (cursor < bytes.length) {
    const length = bytes[cursor++];
    if (length === 0) return cursor;
    if (cursor + length > bytes.length) throw new StegoParseError("GIF 数据子块被截断", cursor - 1);
    cursor += length;
  }
  throw new StegoParseError("GIF 数据子块缺少结束符", cursor);
}

function parseGif(bytes: Uint8Array, sections: StegoSection[], findings: StegoFinding[]) {
  try {
    let cursor = 13;
    const packed = bytes[10];
    if ((packed & 0x80) !== 0) cursor += 3 * (1 << ((packed & 7) + 1));
    while (cursor < bytes.length) {
      const start = cursor;
      const introducer = bytes[cursor++];
      if (introducer === 0x3b) {
        sections.push({ type: "gif-block", name: "Trailer", offset: start, length: 1, status: "ok" });
        return cursor;
      }
      if (introducer === 0x21) {
        const label = bytes[cursor++];
        cursor = skipGifSubBlocks(bytes, cursor);
        sections.push({ type: "gif-extension", name: `Extension 0x${label.toString(16).padStart(2, "0")}`, offset: start, length: cursor - start, status: "ok" });
        continue;
      }
      if (introducer === 0x2c) {
        if (cursor + 9 > bytes.length) throw new StegoParseError("GIF 图像描述符被截断", start);
        const imagePacked = bytes[cursor + 8];
        cursor += 9;
        if ((imagePacked & 0x80) !== 0) cursor += 3 * (1 << ((imagePacked & 7) + 1));
        cursor += 1;
        cursor = skipGifSubBlocks(bytes, cursor);
        sections.push({ type: "gif-image", name: "Image", offset: start, length: cursor - start, status: "ok" });
        continue;
      }
      throw new StegoParseError(`未知 GIF 块 0x${introducer.toString(16)}`, start);
    }
  } catch (error) {
    finding(findings, "high", "GIF 结构损坏", error instanceof Error ? error.message : String(error));
  }
  return undefined;
}

function detectFormat(bytes: Uint8Array) {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "PNG";
  if (startsWith(bytes, [0xff, 0xd8])) return "JPEG";
  if (readSafeAscii(bytes, 0, 6) === "GIF87a" || readSafeAscii(bytes, 0, 6) === "GIF89a") return "GIF";
  if (readSafeAscii(bytes, 0, 2) === "BM") return "BMP";
  if (readSafeAscii(bytes, 0, 4) === "RIFF") return "RIFF";
  if (readSafeAscii(bytes, 0, 4) === "%PDF") return "PDF";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "ZIP";
  if (startsWith(bytes, [0x1f, 0x8b])) return "GZIP";
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (readSafeAscii(bytes, 0, 4) === "Rar!") return "RAR";
  return "未知";
}

function readSafeAscii(bytes: Uint8Array, offset: number, length: number) {
  return offset + length <= bytes.length ? readAscii(bytes, offset, length) : "";
}

function pdfEnd(bytes: Uint8Array) {
  const marker = [0x25, 0x25, 0x45, 0x4f, 0x46];
  for (let offset = bytes.length - marker.length; offset >= 0; offset -= 1) {
    if (marker.every((byte, index) => bytes[offset + index] === byte)) return offset + marker.length;
  }
  return undefined;
}

function offsetCarved(file: LsbExtractedFile, offset: number): LsbExtractedFile {
  return { ...file, offset: file.offset + offset };
}

export function analyzeStructure(bytes: Uint8Array): StegoStructureResult {
  const sections: StegoSection[] = [];
  const findings: StegoFinding[] = [];
  const format = detectFormat(bytes);
  let logicalEnd: number | undefined;

  if (format === "PNG") logicalEnd = parsePng(bytes, sections, findings);
  else if (format === "JPEG") logicalEnd = parseJpeg(bytes, sections, findings);
  else if (format === "GIF") logicalEnd = parseGif(bytes, sections, findings);
  else if (format === "BMP" && bytes.length >= 6) logicalEnd = Math.min(bytes.length, readU32(bytes, 2, "le"));
  else if (format === "RIFF" && bytes.length >= 12) logicalEnd = Math.min(bytes.length, readU32(bytes, 4, "le") + 8);
  else if (format === "PDF") logicalEnd = pdfEnd(bytes);

  const carvedFiles: LsbExtractedFile[] = [];
  if (logicalEnd !== undefined && logicalEnd < bytes.length) {
    const trailing = bytes.subarray(logicalEnd);
    sections.push({ type: "trailing", name: "尾随数据", offset: logicalEnd, length: trailing.length, status: "warning", detail: `熵 ${shannonEntropy(trailing).toFixed(3)}；${hexPreview(trailing, 24)}` });
    finding(findings, "suspicious", "发现文件尾附加数据", `${trailing.length} 字节，熵 ${shannonEntropy(trailing).toFixed(3)}`, logicalEnd);
    carvedFiles.push(...findEmbeddedFiles(trailing).map((file) => offsetCarved(file, logicalEnd)));
  }

  if (logicalEnd === undefined && format !== "未知" && findings.length === 0) finding(findings, "info", "无法确定规范结束位置", `${format} 暂无可靠边界解析器`);
  return { format, sections, findings, carvedFiles, logicalEnd };
}
