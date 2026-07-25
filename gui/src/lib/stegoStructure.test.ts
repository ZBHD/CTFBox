import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { crc32 } from "./stegoBinary";
import { analyzeStructure } from "./stegoStructure";

function concat(...parts: Uint8Array[]) {
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

function pngChunk(type: string, data = new Uint8Array(), corrupt = false) {
  const body = concat(strToU8(type), data);
  return concat(u32be(data.length), body, u32be((crc32(body) + (corrupt ? 1 : 0)) >>> 0));
}

function png(corrupt = false) {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", concat(u32be(1), u32be(1), Uint8Array.of(8, 2, 0, 0, 0)), corrupt),
    pngChunk("IEND"),
  );
}

describe("stego container structure", () => {
  it("validates PNG chunks and carves files after IEND", () => {
    const base = png();
    const archive = zipSync({ "flag.txt": strToU8("ctfshow{tail}") });
    const result = analyzeStructure(concat(base, archive));

    expect(result.format).toBe("PNG");
    expect(result.logicalEnd).toBe(base.length);
    expect(result.sections.map((section) => section.name)).toEqual(["IHDR", "IEND", "尾随数据"]);
    expect(result.carvedFiles[0]).toMatchObject({ mediaType: "application/zip", offset: base.length });
  });

  it("reports a bad PNG CRC without dropping the remaining structure", () => {
    const result = analyzeStructure(png(true));
    expect(result.sections[0].status).toBe("error");
    expect(result.findings.some((finding) => finding.title.includes("CRC"))).toBe(true);
    expect(result.logicalEnd).toBe(png(true).length);
  });

  it("finds JPEG EOI after stuffed bytes and restart markers", () => {
    const jpeg = Uint8Array.of(
      0xff, 0xd8,
      0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0,
      0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33,
      0xff, 0xd9,
    );
    const result = analyzeStructure(concat(jpeg, strToU8("tail")));
    expect(result.format).toBe("JPEG");
    expect(result.logicalEnd).toBe(jpeg.length);
    expect(result.sections.at(-1)?.name).toBe("尾随数据");
  });

  it.each([
    ["GIF", concat(strToU8("GIF89a"), Uint8Array.of(1, 0, 1, 0, 0, 0, 0, 0x3b)), 14],
    ["BMP", concat(Uint8Array.of(0x42, 0x4d, 14, 0, 0, 0), new Uint8Array(8)), 14],
    ["RIFF", concat(strToU8("RIFF"), Uint8Array.of(4, 0, 0, 0), strToU8("WEBP")), 12],
  ])("uses the declared %s boundary", (format, bytes, logicalEnd) => {
    const result = analyzeStructure(concat(bytes, Uint8Array.of(1, 2, 3)));
    expect(result).toMatchObject({ format, logicalEnd });
    expect(result.sections.at(-1)).toMatchObject({ name: "尾随数据", offset: logicalEnd, length: 3 });
  });

  it("keeps partial results for truncated containers", () => {
    const result = analyzeStructure(png().subarray(0, 20));
    expect(result.format).toBe("PNG");
    expect(result.findings.some((finding) => finding.severity === "high")).toBe(true);
  });
});
