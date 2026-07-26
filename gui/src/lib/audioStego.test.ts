import { describe, expect, it } from "vitest";
import { analyzeAudio, type AudioAnalysisInput } from "./audioStego";
import { DEFAULT_AUDIO_OPTIONS, type AudioPcm } from "./audioTypes";

function embedLowBits(text: string, base = 4000): Int32Array {
  const bytes = Array.from(text, (character) => character.charCodeAt(0));
  const samples = new Int32Array(bytes.length * 8);
  let index = 0;
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) samples[index++] = (base & ~1) | ((byte >> bit) & 1);
  }
  return samples;
}

function run(input: AudioAnalysisInput) {
  return analyzeAudio(input, { signal: new AbortController().signal });
}

function baseInput(pcm: AudioPcm, bytes: Uint8Array = new Uint8Array(0)): AudioAnalysisInput {
  return { fileName: "challenge.wav", bytes, pcm, options: { ...DEFAULT_AUDIO_OPTIONS }, prefixes: ["flag"], caseSensitive: false };
}

describe("analyzeAudio", () => {
  it("recovers a flag hidden in the WAV low bits", async () => {
    const pcm: AudioPcm = { sampleRate: 8000, bitDepth: 16, lossy: false, channels: [embedLowBits("flag{demo}")] };
    const report = await run(baseInput(pcm));
    const finding = report.findings.find((item) => item.id === "lsb-flag");
    expect(finding?.detail).toContain("flag{demo}");
    expect(report.strings.some((hit) => hit.text.includes("flag{demo}"))).toBe(true);
  });

  it("carves a file appended after the WAV data chunk", async () => {
    // 极简 mono 16-bit WAV + 末尾追加一个可雕取的 GIF（GIF89a;）
    const gif = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x3b];
    const wav = buildMonoWav([0, 1, -1, 2], gif);
    const pcm: AudioPcm = { sampleRate: 8000, bitDepth: 16, lossy: false, channels: [Int32Array.of(0, 1, -1, 2)] };
    const report = await run(baseInput(pcm, wav));
    expect(report.findings.some((item) => item.id === "wav-trailing")).toBe(true);
    expect(report.carvedFiles.some((file) => file.mediaType === "image/gif")).toBe(true);
  });

  it("detects a flag embedded in the stereo channel difference", async () => {
    const message = embedLowBits("flag{diff}");
    const left = new Int32Array(message.length);
    const right = new Int32Array(message.length);
    for (let i = 0; i < message.length; i += 1) {
      right[i] = 4000;
      left[i] = 4000 + (message[i] & 1); // 差分 = 低位消息，单声道低位为常数
    }
    const pcm: AudioPcm = { sampleRate: 8000, bitDepth: 16, lossy: false, channels: [left, right] };
    const report = await run(baseInput(pcm));
    const finding = report.findings.find((item) => item.id === "diff-flag");
    expect(finding?.source).toBe("声道差分");
    expect(finding?.detail).toContain("flag{diff}");
  });

  it("skips LSB extraction for lossy formats", async () => {
    const pcm: AudioPcm = { sampleRate: 44100, bitDepth: 16, lossy: true, channels: [embedLowBits("flag{demo}")] };
    const report = await run({ ...baseInput(pcm), fileName: "challenge.mp3" });
    expect(report.findings.some((item) => item.id === "lsb-lossy")).toBe(true);
    expect(report.findings.some((item) => item.id === "lsb-flag")).toBe(false);
  });
});

function buildMonoWav(samples: number[], trailing: number[] = []): Uint8Array {
  const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));
  const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const dataBody: number[] = [];
  for (const sample of samples) dataBody.push(sample & 0xff, (sample >> 8) & 0xff);
  const fmtBody = [...u16(1), ...u16(1), ...u32(8000), ...u32(16000), ...u16(2), ...u16(16)];
  const chunks = [
    ...ascii("fmt "), ...u32(fmtBody.length), ...fmtBody,
    ...ascii("data"), ...u32(dataBody.length), ...dataBody,
  ];
  const riffBody = [...ascii("WAVE"), ...chunks];
  return Uint8Array.from([...ascii("RIFF"), ...u32(riffBody.length), ...riffBody, ...trailing]);
}
