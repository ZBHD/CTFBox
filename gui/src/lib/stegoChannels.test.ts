import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { analyzeStegoChannels } from "./stegoChannels";
import { crc32 } from "./stegoBinary";

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16be(value: number) {
  return Uint8Array.of(value >>> 8, value);
}

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function pngChunk(type: string, data = new Uint8Array(), storedCrc?: Uint8Array) {
  const body = concat(strToU8(type), data);
  return concat(u32be(data.length), body, storedCrc ?? u32be(crc32(body)));
}

function png(...chunks: Uint8Array[]) {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", concat(u32be(1), u32be(1), Uint8Array.of(8, 2, 0, 0, 0))),
    ...chunks,
    pngChunk("IEND"),
  );
}

function jpegSegment(marker: number, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), fill = 1) {
  return concat(new Uint8Array(fill).fill(0xff), Uint8Array.of(marker), u16be(payload.length + 2), payload);
}

function bytesToBits(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join("");
}

function gifWithDelays(delays: number[], coordinates: Array<[number, number]> = []) {
  const frames = delays.map((delay, index) => {
    const [left, top] = coordinates[index] ?? [0, 0];
    return concat(
      Uint8Array.of(0x21, 0xf9, 4, 0, delay & 255, delay >>> 8, 0, 0),
      Uint8Array.of(0x2c, left & 255, left >>> 8, top & 255, top >>> 8, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0),
    );
  });
  return concat(strToU8("GIF89a"), Uint8Array.of(64, 0, 64, 0, 0, 0, 0), ...frames, Uint8Array.of(0x3b));
}

describe("format structure covert channels", () => {
  it("decodes printable PNG IDAT lengths and stored bad CRC bytes", () => {
    const flag = "ctfshow{channel_payload}";
    const lengthChunks = Array.from(strToU8(flag), (length) => pngChunk("IDAT", new Uint8Array(length)));
    const crcBytes = concat(strToU8(flag), new Uint8Array((4 - (flag.length % 4)) % 4));
    const crcChunks: Uint8Array[] = [];
    for (let offset = 0; offset < crcBytes.length; offset += 4) crcChunks.push(pngChunk("IDAT", Uint8Array.of(offset), crcBytes.slice(offset, offset + 4)));

    const lengthResult = analyzeStegoChannels(png(...lengthChunks), ["ctfshow"], false);
    const crcResult = analyzeStegoChannels(png(...crcChunks), ["ctfshow"], false);

    expect(lengthResult.candidates).toContainEqual(expect.objectContaining({ source: "PNG IDAT 长度", value: flag }));
    expect(crcResult.candidates).toContainEqual(expect.objectContaining({ source: "PNG 错误 CRC", value: flag }));
  });

  it("tries alignment and polarity when decoding PNG CRC validity bits", () => {
    const flag = "ctfshow{crc_bits}";
    const chunks = Array.from(bytesToBits(strToU8(flag)), (bit, index) => {
      const data = Uint8Array.of(index & 255);
      const body = concat(strToU8("IDAT"), data);
      const valid = u32be(crc32(body));
      const stored = bit === "1" ? valid : Uint8Array.of(valid[0] ^ 1, valid[1], valid[2], valid[3]);
      return pngChunk("IDAT", data, stored);
    });

    const result = analyzeStegoChannels(png(...chunks), ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({ source: "PNG CRC 正误", value: flag }));
  });

  it("extracts APNG fcTL delays and renders offset coordinates", () => {
    const flag = "ctfshow{apng_fields}";
    const chunks = Array.from(strToU8(flag), (delay, index) => pngChunk("fcTL", concat(
      u32be(index), u32be(1), u32be(1), u32be(index * 2), u32be(index % 5), u16be(delay), u16be(100), Uint8Array.of(0, 0),
    )));

    const result = analyzeStegoChannels(png(...chunks), ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({ source: "APNG fcTL delay_num", value: flag }));
    expect(result.visuals).toContainEqual(expect.objectContaining({ id: "apng-offset-scatter" }));
  });

  it("decodes two GIF delay clusters as 7-bit text and plots frame offsets", () => {
    const flag = "ctfshow{gif_delay}";
    const bits = Array.from(strToU8(flag), (byte) => byte.toString(2).padStart(7, "0")).join("");
    const delays = Array.from(bits, (bit) => bit === "0" ? 36 : 37);
    const coordinates = delays.map((_, index) => [index % 32, Math.floor(index / 32)] as [number, number]);

    const result = analyzeStegoChannels(gifWithDelays(delays, coordinates), ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({ source: "GIF 帧延时", value: flag }));
    expect(result.visuals).toContainEqual(expect.objectContaining({ id: "gif-offset-scatter" }));
  });

  it("decodes JPEG FF run lengths using an embedded count hint", () => {
    const encodedRuns = Array.from({ length: 7 }, (_, index) => jpegSegment(0xe0, new Uint8Array(), index + 2));
    const jpeg = concat(
      Uint8Array.of(0xff, 0xd8),
      ...encodedRuns,
      jpegSegment(0xfe, strToU8("ctfshow{8}")),
      Uint8Array.of(0xff, 0xd9),
    );

    const result = analyzeStegoChannels(jpeg, ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      source: "JPEG FF 游程",
      value: "ctfshow{01234567}",
    }));
  });

  it("decodes low nibbles from a dense JPEG APP marker sequence", () => {
    const payload = "0c618671a153f5da3948fdb2a2238e44";
    const markers = Array.from(payload.slice(1), (digit) => jpegSegment(0xe0 + Number.parseInt(digit, 16), Uint8Array.of(1)));
    const jpeg = concat(
      Uint8Array.of(0xff, 0xd8),
      jpegSegment(0xe0, strToU8("JFIF\0")),
      ...markers,
      Uint8Array.of(0xff, 0xd9),
    );

    const result = analyzeStegoChannels(jpeg, ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      source: "JPEG APP 标记",
      value: `ctfshow{${payload}}`,
    }));
  });

  it("decodes variable-length JPEG APP marker payloads for a configured prefix", () => {
    const payload = "19af02bc73de";
    const jpeg = concat(
      Uint8Array.of(0xff, 0xd8),
      ...Array.from(payload, (digit) => jpegSegment(0xe0 + Number.parseInt(digit, 16))),
      Uint8Array.of(0xff, 0xd9),
    );

    const result = analyzeStegoChannels(jpeg, ["demo"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      source: "JPEG APP 标记",
      value: `demo{${payload}}`,
    }));
  });

  it("decodes parity bits concatenated across JPEG quantization tables", () => {
    const flag = "ctfshow{dqt_bits}";
    const bits = bytesToBits(strToU8(flag));
    const tables: Uint8Array[] = [];
    for (let offset = 0; offset < bits.length; offset += 64) {
      const values = Uint8Array.from({ length: 64 }, (_, index) => 2 | Number(bits[offset + index] ?? "0"));
      tables.push(concat(Uint8Array.of(tables.length), values));
    }
    const jpeg = concat(
      Uint8Array.of(0xff, 0xd8),
      jpegSegment(0xdb, concat(...tables)),
      Uint8Array.of(0xff, 0xd9),
    );

    const result = analyzeStegoChannels(jpeg, ["ctfshow"], false);

    expect(result.candidates).toContainEqual(expect.objectContaining({
      source: "JPEG DQT 奇偶",
      value: flag,
    }));
  });
});
