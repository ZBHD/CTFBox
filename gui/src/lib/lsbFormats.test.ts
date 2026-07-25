import { describe, expect, it } from "vitest";
import {
  bytesToHexPreview,
  decodeTextPreview,
  findEmbeddedFiles,
  scoreLsbPayload,
} from "./lsbFormats";

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
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

function u32le(value: number) {
  return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24);
}

function minimalPng() {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    u32be(0),
    encoder.encode("IEND"),
    new Uint8Array(4),
  );
}

function zipWithEocd() {
  return concat(
    Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4),
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    new Uint8Array(18),
  );
}

describe("LSB file carving", () => {
  it("finds an embedded ZIP and truncates bytes exactly after EOCD", () => {
    const zip = zipWithEocd();
    const payload = concat(Uint8Array.of(9, 8, 7), zip, Uint8Array.of(6, 5, 4));
    const carved = findEmbeddedFiles(payload).find((file) => file.mediaType === "application/zip");

    expect(carved).toMatchObject({ offset: 3, mediaType: "application/zip" });
    expect(carved?.bytes).toEqual(zip);
  });

  it("recognizes common embedded file signatures", () => {
    const bmp = concat(encoder.encode("BM"), u32le(14), new Uint8Array(8));
    const wav = concat(encoder.encode("RIFF"), u32le(4), encoder.encode("WAVE"));
    const cases: Array<[string, Uint8Array]> = [
      ["image/png", minimalPng()],
      ["image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9)],
      ["image/gif", concat(encoder.encode("GIF89a"), Uint8Array.of(1, 2, 0x3b))],
      ["application/gzip", Uint8Array.of(0x1f, 0x8b, 0x08, 0, 1, 2, 3, 4)],
      ["application/pdf", encoder.encode("%PDF-1.7\nbody\n%%EOF")],
      ["application/x-7z-compressed", Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 1, 2)],
      ["application/vnd.rar", Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 1)],
      ["image/bmp", bmp],
      ["audio/wav", wav],
      ["application/x-elf", Uint8Array.of(0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4)],
    ];

    for (const [mediaType, bytes] of cases) {
      expect(findEmbeddedFiles(concat(Uint8Array.of(0xaa), bytes)).some((file) => file.mediaType === mediaType), mediaType).toBe(true);
    }
  });

  it("uses structured PNG, BMP, WAV, JPEG, GIF and PDF boundaries", () => {
    const png = minimalPng();
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9);
    const gif = concat(encoder.encode("GIF89a"), Uint8Array.of(1, 2, 0x3b));
    const pdf = encoder.encode("%PDF-1.7\n%%EOF");
    const bmp = concat(encoder.encode("BM"), u32le(14), new Uint8Array(8));
    const wav = concat(encoder.encode("RIFF"), u32le(4), encoder.encode("WAVE"));

    for (const bytes of [png, jpeg, gif, pdf, bmp, wav]) {
      const carved = findEmbeddedFiles(concat(bytes, Uint8Array.of(9, 9, 9)))[0];
      expect(carved.bytes).toEqual(bytes);
    }
  });
});

describe("LSB payload previews and scoring", () => {
  it("formats bounded hexadecimal and text previews", () => {
    expect(bytesToHexPreview(Uint8Array.from([0, 1, 0xfe, 0xff]))).toContain("00 01 fe ff");
    expect(decodeTextPreview(encoder.encode("hello\nworld"))).toMatchObject({ text: "hello\nworld", printableRatio: 1 });
  });

  it("ranks flags above readable text and noise", () => {
    const flag = scoreLsbPayload(encoder.encode("ctfshow{found}"), ["ctfshow"], false);
    const text = scoreLsbPayload(encoder.encode("This is ordinary readable text."), ["ctfshow"], false);
    const zeros = scoreLsbPayload(new Uint8Array(64), ["ctfshow"], false);
    const noise = scoreLsbPayload(Uint8Array.from({ length: 64 }, (_, index) => (index * 73 + 19) & 255), ["ctfshow"], false);

    expect(flag.score).toBeGreaterThan(text.score);
    expect(text.score).toBeGreaterThan(zeros.score);
    expect(text.score).toBeGreaterThan(noise.score);
    expect(flag.evidence).toContain("发现 Flag：ctfshow{found}");
  });

  it("surfaces probable flags even when their prefix is not configured", () => {
    const payload = concat(
      encoder.encode("ctfshow{auto-prefix}"),
      Uint8Array.from({ length: 256 }, (_, index) => (index * 73 + 19) & 255),
    );
    const scored = scoreLsbPayload(payload, ["flag", "CTF"], false);

    expect(scored.evidence).toContain("疑似 Flag：ctfshow{auto-prefix}");
    expect(scored.preview).toContain("ctfshow{auto-prefix}");
  });

  it("rewards structurally complete embedded files", () => {
    const scored = scoreLsbPayload(concat(Uint8Array.of(1, 2), minimalPng()), ["ctfshow"], false);
    expect(scored.mediaType).toBe("image/png");
    expect(scored.files[0]).toMatchObject({ offset: 2, mediaType: "image/png" });
    expect(scored.evidence.some((item) => item.includes("PNG"))).toBe(true);
  });
});
