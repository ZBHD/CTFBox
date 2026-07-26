import { strToU8, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { crc32 } from "./stegoBinary";
import { extractStegoMetadata } from "./stegoMetadata";

function concat(...parts: Uint8Array<ArrayBufferLike>[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function u16(value: number, order: "le" | "be") {
  return order === "le" ? Uint8Array.of(value, value >>> 8) : Uint8Array.of(value >>> 8, value);
}

function u32(value: number, order: "le" | "be") {
  return order === "le"
    ? Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24)
    : Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function utf16le(value: string) {
  return Uint8Array.from(Array.from(`${value}\0`).flatMap((character) => {
    const codePoint = character.charCodeAt(0);
    return [codePoint & 0xff, codePoint >>> 8];
  }));
}

function tiff(order: "le" | "be", definitions: Array<{ tag: number; type: 1 | 2; bytes: Uint8Array }>) {
  const ifdLength = 2 + definitions.length * 12 + 4;
  let valueOffset = 8 + ifdLength;
  const entries: Uint8Array[] = [];
  const values: Uint8Array[] = [];
  for (const definition of definitions) {
    const inline = definition.bytes.length <= 4;
    const value = inline
      ? concat(definition.bytes, new Uint8Array(4 - definition.bytes.length))
      : u32(valueOffset, order);
    entries.push(concat(
      u16(definition.tag, order),
      u16(definition.type, order),
      u32(definition.bytes.length, order),
      value,
    ));
    if (!inline) {
      values.push(definition.bytes);
      valueOffset += definition.bytes.length;
    }
  }
  return concat(
    order === "le" ? strToU8("II") : strToU8("MM"),
    u16(42, order),
    u32(8, order),
    u16(definitions.length, order),
    ...entries,
    u32(0, order),
    ...values,
  );
}

function chunk(type: string, data: Uint8Array<ArrayBufferLike> = new Uint8Array()) {
  const body = concat(strToU8(type), data);
  return concat(u32be(data.length), body, u32be(crc32(body)));
}

function png(...chunks: Uint8Array<ArrayBufferLike>[]) {
  return concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), ...chunks, chunk("IEND"));
}

function littleEndianExif() {
  return Uint8Array.of(
    0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0,
    1, 0,
    0x31, 0x01, 2, 0, 4, 0, 0, 0, 0x43, 0x54, 0x46, 0,
    0, 0, 0, 0,
  );
}

function jpegSegment(marker: number, payload: Uint8Array<ArrayBufferLike>) {
  const length = payload.length + 2;
  return concat(Uint8Array.of(0xff, marker, length >>> 8, length), payload);
}

describe("stego metadata extraction", () => {
  it("extracts PNG text, compressed text, international text and Exif", () => {
    const bytes = png(
      chunk("tEXt", strToU8("Comment\0plain-value")),
      chunk("zTXt", concat(strToU8("Secret\0"), Uint8Array.of(0), zlibSync(strToU8("compressed-value")))),
      chunk("iTXt", strToU8("Title\0\0\0zh-CN\0\0international-value")),
      chunk("eXIf", littleEndianExif()),
    );
    const result = extractStegoMetadata(bytes);

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "PNG 文本", key: "Comment", value: "plain-value" }),
      expect.objectContaining({ group: "PNG 文本", key: "Secret", value: "compressed-value" }),
      expect.objectContaining({ group: "PNG iTXt", key: "Title", value: "international-value" }),
      expect.objectContaining({ group: "EXIF", key: "Software", value: "CTF" }),
    ]));
  });

  it("extracts JPEG Exif, XMP, ICC and comments", () => {
    const jpeg = concat(
      Uint8Array.of(0xff, 0xd8),
      jpegSegment(0xe1, concat(strToU8("Exif\0\0"), littleEndianExif())),
      jpegSegment(0xe1, concat(strToU8("http://ns.adobe.com/xap/1.0/\0"), strToU8("<x:xmpmeta>ctfshow{xmp}</x:xmpmeta>"))),
      jpegSegment(0xe2, concat(strToU8("ICC_PROFILE\0"), Uint8Array.of(1, 1, 4, 5))),
      jpegSegment(0xfe, strToU8("jpeg-comment")),
      Uint8Array.of(0xff, 0xd9),
    );
    const result = extractStegoMetadata(jpeg);

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "EXIF", key: "Software", value: "CTF" }),
      expect.objectContaining({ group: "XMP", value: expect.stringContaining("ctfshow{xmp}") }),
      expect.objectContaining({ group: "ICC", value: expect.stringContaining("第 1/1 段") }),
      expect.objectContaining({ group: "JPEG", key: "Comment", value: "jpeg-comment" }),
    ]));
  });

  it("reports invalid TIFF offsets and keeps other metadata", () => {
    const broken = Uint8Array.of(0x49, 0x49, 0x2a, 0, 0xff, 0xff, 0xff, 0x7f);
    const bytes = png(chunk("tEXt", strToU8("Good\0still-here")), chunk("eXIf", broken));
    const result = extractStegoMetadata(bytes);

    expect(result.entries).toContainEqual(expect.objectContaining({ key: "Good", value: "still-here" }));
    expect(result.findings.some((finding) => finding.title.includes("EXIF"))).toBe(true);
  });

  it("extracts standalone TIFF fields, all Windows XP tags and assembled flag fragments", () => {
    const bytes = tiff("le", [
      { tag: 0x010d, type: 2, bytes: strToU8("ctfshow{0011223344556677\0") },
      { tag: 0x013c, type: 2, bytes: strToU8("8899aabbccddeeff}\0") },
      { tag: 0x9c9b, type: 1, bytes: utf16le("title") },
      { tag: 0x9c9c, type: 1, bytes: utf16le("comment") },
      { tag: 0x9c9d, type: 1, bytes: utf16le("author") },
      { tag: 0x9c9e, type: 1, bytes: utf16le("keywords") },
      { tag: 0x9c9f, type: 1, bytes: utf16le("subject") },
      { tag: 0xa434, type: 2, bytes: strToU8("lens-value\0") },
    ]);
    const result = extractStegoMetadata(bytes);

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "DocumentName", value: "ctfshow{0011223344556677" }),
      expect.objectContaining({ key: "HostComputer", value: "8899aabbccddeeff}" }),
      expect.objectContaining({ key: "XPTitle", value: "title" }),
      expect.objectContaining({ key: "XPComment", value: "comment" }),
      expect.objectContaining({ key: "XPAuthor", value: "author" }),
      expect.objectContaining({ key: "XPKeywords", value: "keywords" }),
      expect.objectContaining({ key: "XPSubject", value: "subject" }),
      expect.objectContaining({ key: "LensModel", value: "lens-value" }),
    ]));
    expect(result.findings).toContainEqual(expect.objectContaining({
      title: "元数据组合发现 Flag",
      detail: "ctfshow{00112233445566778899aabbccddeeff}",
    }));
  });

  it("recognizes a standalone big-endian TIFF header", () => {
    const result = extractStegoMetadata(tiff("be", [
      { tag: 0x0131, type: 2, bytes: strToU8("BE-tool\0") },
    ]));

    expect(result.entries).toContainEqual(expect.objectContaining({ key: "Software", value: "BE-tool" }));
  });

  it("derives a configured prefix from Chinese homophone metadata without fixed payload length", () => {
    const jpeg = concat(
      Uint8Array.of(0xff, 0xd8),
      jpegSegment(0xfe, strToU8("弟易艾姆哦大括号诶必西弟大括号")),
      Uint8Array.of(0xff, 0xd9),
    );

    const result = extractStegoMetadata(jpeg, { prefixes: ["demo"] });

    expect(result.findings).toContainEqual(expect.objectContaining({
      title: "中文同音字符派生 Flag",
      detail: "demo{abcd}",
    }));
  });

  it("derives variable-count fixed-width hexadecimal groups from decimal metadata", () => {
    const bytes = tiff("le", [
      { tag: 0x010d, type: 2, bytes: strToU8("demo{}\0") },
      { tag: 0x010e, type: 2, bytes: strToU8(`${0x12345678}\0`) },
      { tag: 0x010f, type: 2, bytes: strToU8(`${0x9abcdef0}\0`) },
      { tag: 0x0110, type: 2, bytes: strToU8(`${0x0badcafe}\0`) },
    ]);

    const result = extractStegoMetadata(bytes, { prefixes: ["demo"] });

    expect(result.findings).toContainEqual(expect.objectContaining({
      title: "EXIF 十进制转十六进制 Flag",
      detail: "demo{123456789abcdef00badcafe}",
    }));
  });

  it("assembles configured metadata fragments without assuming a 32-character payload", () => {
    const bytes = tiff("le", [
      { tag: 0x010d, type: 2, bytes: strToU8("demo{001122\0") },
      { tag: 0x010f, type: 2, bytes: strToU8("33445566\0") },
      { tag: 0x0110, type: 2, bytes: strToU8("778899}\0") },
    ]);

    const result = extractStegoMetadata(bytes, { prefixes: ["demo"] });

    expect(result.findings).toContainEqual(expect.objectContaining({
      title: "元数据组合发现 Flag",
      detail: "demo{00112233445566778899}",
    }));
  });
});
