// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { join } from "node:path";
import { gzipSync, strToU8, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { LsbExtractedFile } from "./lsbTypes";
import { scanEmbeddedContent } from "./stegoCarving";

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function flatten(files: LsbExtractedFile[]): LsbExtractedFile[] {
  return files.flatMap((file) => [file, ...flatten(file.children ?? [])]);
}

function minimalPng() {
  return Uint8Array.of(
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  );
}

describe("recursive full-file carving", () => {
  it("finds a structurally complete JPEG away from the container tail", async () => {
    const embedded = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9);
    const result = await scanEmbeddedContent(concat(new Uint8Array(37), embedded, new Uint8Array(20)), { prefixes: ["ctfshow"] });

    expect(result.files).toContainEqual(expect.objectContaining({ mediaType: "image/jpeg", offset: 37, bytes: embedded }));
  });

  it("decompresses zlib and recursively carves files produced by gzip", async () => {
    const zlib = zlibSync(strToU8("ctfshow{zlib_stream}"));
    const gzip = gzipSync(concat(minimalPng(), strToU8("ctfshow{gzip_child}")));
    const result = await scanEmbeddedContent(concat(Uint8Array.of(9, 8, 7), zlib, Uint8Array.of(0), gzip), { prefixes: ["ctfshow"] });
    const files = flatten(result.files);

    expect(files).toContainEqual(expect.objectContaining({ mediaType: "application/zlib", text: "ctfshow{zlib_stream}" }));
    expect(files).toContainEqual(expect.objectContaining({ mediaType: "image/png" }));
    expect(files.some((file) => file.text?.includes("ctfshow{gzip_child}"))).toBe(true);
  });

  it("returns a warning instead of expanding a compressed payload beyond configured limits", async () => {
    const result = await scanEmbeddedContent(zlibSync(new Uint8Array(4096)), {
      prefixes: [],
      maxFileBytes: 128,
      maxTotalBytes: 128,
      maxCompressionRatio: 4,
    });

    expect(flatten(result.files).some((file) => file.warning?.includes("限制"))).toBe(true);
  });

  it("reports a recognized but corrupted LZMA stream instead of silently discarding it", async () => {
    const corrupted = Uint8Array.of(
      0x5d, 0x00, 0x00, 0x80, 0x00,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0x00, 0x01, 0x02, 0x03,
    );
    const result = await scanEmbeddedContent(corrupted, { prefixes: ["ctfshow"] });

    expect(flatten(result.files).some((file) => file.warning?.includes("LZMA 解压失败"))).toBe(true);
  });
});

const corpus = "D:\\Projects\\MiscTest";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("recursive carving real-corpus regression", () => {
  corpusIt("carves the second JPEG in misc14", async () => {
    const result = await scanEmbeddedContent(new Uint8Array(readFileSync(join(corpus, "misc14.jpg"))), { prefixes: ["ctfshow"] });
    expect(flatten(result.files)).toContainEqual(expect.objectContaining({ mediaType: "image/jpeg", offset: 2103 }));
  });

  corpusIt("decompresses the second zlib stream in misc10", async () => {
    const result = await scanEmbeddedContent(new Uint8Array(readFileSync(join(corpus, "misc10.png"))), { prefixes: ["ctfshow"] });
    expect(flatten(result.files).some((file) => file.text?.includes("ctfshow{353252424ac69cb64f643768851ac790}"))).toBe(true);
  });

  corpusIt("decompresses the LZMA-Alone stream in misc16", async () => {
    const result = await scanEmbeddedContent(new Uint8Array(readFileSync(join(corpus, "misc16.png"))), { prefixes: ["ctfshow"] });
    expect(flatten(result.files).some((file) => file.text?.includes("ctfshow{a7e32f131c011290a62476ae77190b52}"))).toBe(true);
  });

  corpusIt("decompresses the BZip2 stream and finds the nested PNG in misc17", async () => {
    const result = await scanEmbeddedContent(new Uint8Array(readFileSync(join(corpus, "misc17.png"))), { prefixes: ["ctfshow"] });
    expect(flatten(result.files).some((file) => file.mediaType === "image/png" && file.offset === 0)).toBe(true);
  });

  corpusIt("exports the EXIF thumbnail JPEG from misc22", async () => {
    const result = await scanEmbeddedContent(new Uint8Array(readFileSync(join(corpus, "misc22.jpg"))), { prefixes: ["ctfshow"] });
    expect(flatten(result.files).filter((file) => file.mediaType === "image/jpeg").some((file) => file.offset > 0)).toBe(true);
  });
});
