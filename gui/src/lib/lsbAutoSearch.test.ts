import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { autoSearchLsb } from "./lsbAutoSearch";
import type { LsbExtractionParameters, LsbImageSource, LsbSourceToken } from "./lsbTypes";

function bitsForBytes(bytes: Uint8Array) {
  return Array.from(bytes).flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1));
}

function pixelOrder(width: number, height: number, parameters: LsbExtractionParameters) {
  const xs = Array.from({ length: width }, (_, index) => parameters.scan.x === "left-to-right" ? index : width - index - 1);
  const ys = Array.from({ length: height }, (_, index) => parameters.scan.y === "top-to-bottom" ? index : height - index - 1);
  const order: number[] = [];
  if (parameters.scan.major === "row") {
    for (const y of ys) for (const x of xs) order.push(y * width + x);
  } else {
    for (const x of xs) for (const y of ys) order.push(y * width + x);
  }
  return order;
}

function channelOffset(token: LsbSourceToken) {
  return token.channel === "R" ? 0 : token.channel === "G" ? 1 : token.channel === "B" ? 2 : 3;
}

function embed(payload: Uint8Array, parameters: LsbExtractionParameters, width = 48): LsbImageSource {
  const bitCount = payload.length * 8;
  const pixelCount = Math.ceil(bitCount / parameters.sources.length);
  const height = Math.ceil(pixelCount / width);
  const rgba = new Uint8Array(width * height * 4);
  rgba.filter((_, index) => index % 4 === 3).fill(255);
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba[pixel * 4 + 3] = 255;
  const order = pixelOrder(width, height, parameters);
  const bits = bitsForBytes(payload);
  bits.forEach((bit, index) => {
    const token = parameters.sources[index % parameters.sources.length];
    const pixel = order[Math.floor(index / parameters.sources.length)];
    const offset = pixel * 4 + channelOffset(token);
    rgba[offset] = (rgba[offset] & ~(1 << token.bit)) | (bit << token.bit);
  });
  return { width, height, rgba };
}

function parameters(sources: LsbSourceToken[], scan: Partial<LsbExtractionParameters["scan"]> = {}): LsbExtractionParameters {
  return {
    sourceKind: "rgba",
    sources,
    scan: {
      major: "row",
      x: "left-to-right",
      y: "top-to-bottom",
      serpentine: false,
      reversePixels: false,
      ...scan,
    },
    layout: "pixel-interleaved",
    packing: "msb-first",
    bitOffset: 0,
    invertBits: false,
    reverseBytes: false,
    byteOffset: 0,
  };
}

async function search(source: LsbImageSource, depth: "quick" | "deep" = "quick") {
  return autoSearchLsb(source, {
    depth,
    prefixes: ["ctfshow"],
    caseSensitive: false,
    signal: new AbortController().signal,
  });
}

describe("LSB automatic analysis", () => {
  it("finds row-major RGB text", async () => {
    const expected = "ctfshow{row-rgb}";
    const source = embed(strToU8(expected), parameters([
      { channel: "R", bit: 0 },
      { channel: "G", bit: 0 },
      { channel: "B", bit: 0 },
    ]));

    const candidates = await search(source);
    expect(candidates[0].preview).toContain(expected);
    expect(candidates[0].parameters.sources).toEqual(parameters([
      { channel: "R", bit: 0 },
      { channel: "G", bit: 0 },
      { channel: "B", bit: 0 },
    ]).sources);
  }, 20_000);

  it("finds column-major ABG text", async () => {
    const expected = "ctfshow{column-abg}";
    const extraction = parameters([
      { channel: "A", bit: 0 },
      { channel: "B", bit: 0 },
      { channel: "G", bit: 0 },
    ], { major: "column" });

    const candidates = await search(embed(strToU8(expected), extraction, 8));
    expect(candidates[0].preview).toContain(expected);
    expect(candidates[0].parameters.scan.major).toBe("column");
  }, 20_000);

  it("finds a reverse-column ZIP and its internal flag", async () => {
    const archive = zipSync({ "旗子": strToU8("ctfshow{zip-inside}") });
    const extraction = parameters([
      { channel: "R", bit: 0 },
      { channel: "G", bit: 0 },
      { channel: "B", bit: 0 },
    ], { major: "column", y: "bottom-to-top" });

    const candidates = await search(embed(archive, extraction, 12));
    expect(candidates[0].mediaType).toBe("application/zip");
    expect(candidates[0].files[0].children?.[0].text).toBe("ctfshow{zip-inside}");
  }, 20_000);

  it("finds systematic mixed-bit profiles in deep mode", async () => {
    const expected = "ctfshow{mixed-bits}";
    const extraction = parameters([
      { channel: "R", bit: 4 },
      { channel: "R", bit: 2 },
      { channel: "R", bit: 1 },
      { channel: "G", bit: 4 },
      { channel: "G", bit: 2 },
      { channel: "G", bit: 1 },
    ]);

    const candidates = await search(embed(strToU8(expected), extraction), "deep");
    expect(candidates[0].preview).toContain(expected);
    expect(candidates[0].parameters.sources).toEqual(extraction.sources);
  }, 30_000);

  it("reports monotonic progress and aborts cooperatively", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const source = embed(strToU8("ordinary payload without a flag"), parameters([{ channel: "R", bit: 0 }]));
    const pending = autoSearchLsb(source, {
      depth: "deep",
      prefixes: ["ctfshow"],
      caseSensitive: false,
      signal: controller.signal,
      onProgress: (value) => {
        progress.push(value.tested);
        if (value.tested >= 256) controller.abort();
      },
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  }, 20_000);

  it("deduplicates equal payloads with stable ordering", async () => {
    const source = embed(strToU8("ctfshow{stable}"), parameters([{ channel: "R", bit: 0 }]));
    const first = await search(source);
    const second = await search(source);

    expect(first.map((candidate) => candidate.id)).toEqual(second.map((candidate) => candidate.id));
    expect(new Set(first.map((candidate) => `${candidate.bytes.length}:${candidate.preview}`)).size).toBe(first.length);
  }, 20_000);
});
