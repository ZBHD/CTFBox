import { describe, expect, it } from "vitest";
import { decodeWavSamples, parseWavChunks } from "./wavDecoder";

function ascii(text: string) {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function u32(value: number) {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function u16(value: number) {
  return [value & 0xff, (value >> 8) & 0xff];
}

interface WavSpec {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  samples: number[][]; // 每声道整数样本
  listInfo?: Array<[string, string]>;
  trailing?: number[];
}

function encodeSample(value: number, bits: number) {
  if (bits === 8) return [value & 0xff];
  if (bits === 16) return [value & 0xff, (value >> 8) & 0xff];
  if (bits === 24) return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
  return u32(value >>> 0);
}

function buildWav(spec: WavSpec): Uint8Array {
  const bytesPerSample = spec.bitsPerSample / 8;
  const frames = spec.samples[0]?.length ?? 0;
  const dataBody: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < spec.channels; channel += 1) {
      dataBody.push(...encodeSample(spec.samples[channel][frame], spec.bitsPerSample));
    }
  }
  const fmtBody = [
    ...u16(1),
    ...u16(spec.channels),
    ...u32(spec.sampleRate),
    ...u32(spec.sampleRate * spec.channels * bytesPerSample),
    ...u16(spec.channels * bytesPerSample),
    ...u16(spec.bitsPerSample),
  ];
  const chunks: number[] = [...ascii("fmt "), ...u32(fmtBody.length), ...fmtBody];

  if (spec.listInfo) {
    const infoBody: number[] = [...ascii("INFO")];
    for (const [id, text] of spec.listInfo) {
      const raw = ascii(text);
      if (raw.length % 2 === 1) raw.push(0);
      infoBody.push(...ascii(id), ...u32(raw.length), ...raw);
    }
    chunks.push(...ascii("LIST"), ...u32(infoBody.length), ...infoBody);
  }

  chunks.push(...ascii("data"), ...u32(dataBody.length), ...dataBody);
  if (dataBody.length % 2 === 1) chunks.push(0);

  const riffBody = [...ascii("WAVE"), ...chunks];
  const bytes = [...ascii("RIFF"), ...u32(riffBody.length), ...riffBody];
  if (spec.trailing) bytes.push(...spec.trailing);
  return Uint8Array.from(bytes);
}

describe("wavDecoder", () => {
  it("decodes 16-bit stereo PCM exactly as written", () => {
    const left = [0, 1000, -1000, 32767, -32768];
    const right = [-1, 2, -3, 4, -5];
    const wav = buildWav({ channels: 2, sampleRate: 44100, bitsPerSample: 16, samples: [left, right] });
    const decoded = decodeWavSamples(wav);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.bitDepth).toBe(16);
    expect(Array.from(decoded.channels[0])).toEqual(left);
    expect(Array.from(decoded.channels[1])).toEqual(right);
  });

  it("decodes 8-bit unsigned and 24-bit signed samples", () => {
    const eight = buildWav({ channels: 1, sampleRate: 8000, bitsPerSample: 8, samples: [[0, 128, 255, 1]] });
    expect(Array.from(decodeWavSamples(eight).channels[0])).toEqual([0, 128, 255, 1]);

    const twentyFour = buildWav({ channels: 1, sampleRate: 8000, bitsPerSample: 24, samples: [[0, 8388607, -8388608, -1]] });
    expect(Array.from(decodeWavSamples(twentyFour).channels[0])).toEqual([0, 8388607, -8388608, -1]);
  });

  it("extracts LIST/INFO metadata and trailing bytes", () => {
    const wav = buildWav({
      channels: 1,
      sampleRate: 8000,
      bitsPerSample: 16,
      samples: [[1, 2, 3, 4]],
      listInfo: [["INAM", "ChalName"], ["ISFT", "CTFBox"]],
      trailing: [0x89, 0x50, 0x4e, 0x47],
    });
    const container = parseWavChunks(wav);
    expect(container.metadata.map((entry) => entry.value)).toContain("CTFBox");
    expect(container.metadata.some((entry) => entry.key === "标题" && entry.value === "ChalName")).toBe(true);
    expect(Array.from(container.trailing)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects a non-RIFF buffer", () => {
    expect(() => decodeWavSamples(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toThrow("RIFF");
  });

  it("rejects a chunk whose declared length overflows the buffer", () => {
    const wav = buildWav({ channels: 1, sampleRate: 8000, bitsPerSample: 16, samples: [[1, 2]] });
    // 篡改 data 块长度为超大值（data 块位于末尾）
    const dataSizeOffset = wav.length - 4 - 4; // data 声明长度字段
    const broken = wav.slice();
    broken[dataSizeOffset] = 0xff;
    broken[dataSizeOffset + 1] = 0xff;
    expect(() => parseWavChunks(broken)).toThrow("越界");
  });
});
