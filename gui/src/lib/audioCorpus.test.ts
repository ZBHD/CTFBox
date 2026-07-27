// @ts-expect-error vitest runs in Node
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error vitest runs in Node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWavChunks } from "./wavDecoder";
import { detectDtmf } from "./audioDtmf";
import { extractLsbBytes } from "./audioLsb";

const corpus = "D:\\Projects\\CTFBox\\artifacts\\test-corpus\\audio-stego";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("音频隐写增强 — 真实题型验证", () => {
  corpusIt("DTMF 01: 拨号音解码 1-2-3-4", () => {
    const bytes = new Uint8Array(readFileSync(join(corpus, "dtmf/challenge-01-dtmf.wav")));
    const container = parseWavChunks(bytes);
    expect(container.dataChunk).toBeDefined();

    const dataOffset = container.dataChunk!.offset + 8;
    const dataSize = container.dataChunk!.size;
    const sampleCount = dataSize / 2;
    const samples = new Int32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, dataSize);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = view.getInt16(i * 2, true);
    }

    const result = detectDtmf(samples, 8000);
    expect(result.detected).toBe(true);
    expect(result.sequence).toContain("1234");
  });

  corpusIt("LSB 01: WAV 低位提取 Flag", () => {
    const bytes = new Uint8Array(readFileSync(join(corpus, "lsb/challenge-01-lsb.wav")));
    const container = parseWavChunks(bytes);
    expect(container.dataChunk).toBeDefined();
    const dataOffset = container.dataChunk!.offset + 8;
    const dataSize = container.dataChunk!.size;
    const sampleCount = dataSize / 2;
    const channel = new Int32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, dataSize);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = view.getInt16(i * 2, true);
    }
    const lsbBytes = extractLsbBytes([channel], "L", "perChannel", 1);
    const text = new TextDecoder().decode(lsbBytes.subarray(0, 100));
    expect(text).toContain("flag{audio_lsb}");
  });
});
