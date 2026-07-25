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
});
