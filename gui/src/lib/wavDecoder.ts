// 直接解析 RIFF/WAVE 容器，输出样本精确的整数 PCM，并抽取 LIST/INFO 元数据与 data 块后附加数据。
// LSB 隐写依赖精确整数样本，因此只有直接解析才可靠（不经 WebAudio 重采样）。
import type { StegoMetadataEntry } from "./stegoTypes";

export interface WavFormat {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export interface WavChunk {
  id: string;
  offset: number;
  size: number;
}

export interface WavContainer {
  format?: WavFormat;
  dataChunk?: WavChunk;
  chunks: WavChunk[];
  metadata: StegoMetadataEntry[];
  trailing: Uint8Array;
  trailingOffset: number;
}

export interface WavSamples {
  sampleRate: number;
  bitDepth: number;
  channels: Int32Array[];
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  let value = "";
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(bytes[offset + i]);
  return value;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

const INFO_LABELS: Record<string, string> = {
  INAM: "标题",
  IART: "艺术家",
  IPRD: "专辑",
  ICMT: "备注",
  ICRD: "日期",
  ISFT: "软件",
  IGNR: "流派",
  ICOP: "版权",
  IENG: "工程",
};

function parseInfoList(bytes: Uint8Array, start: number, end: number, metadata: StegoMetadataEntry[]) {
  let offset = start;
  while (offset + 8 <= end) {
    const id = readAscii(bytes, offset, 4);
    const size = readUint32(bytes, offset + 4);
    const bodyStart = offset + 8;
    if (bodyStart + size > end) break;
    const raw = readAscii(bytes, bodyStart, size).replace(/\0+$/g, "").trim();
    if (raw) metadata.push({ group: "RIFF INFO", key: INFO_LABELS[id] ?? id, value: raw, offset: bodyStart });
    offset = bodyStart + size + (size & 1);
  }
}

// 遍历所有 chunk，不解码样本；用于元数据、data 定位与 trailing 抽取。
export function parseWavChunks(bytes: Uint8Array): WavContainer {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("不是有效的 RIFF/WAVE 文件");
  }
  const riffSize = readUint32(bytes, 4);
  const declaredEnd = Math.min(bytes.length, 8 + riffSize);
  const chunks: WavChunk[] = [];
  const metadata: StegoMetadataEntry[] = [];
  let format: WavFormat | undefined;
  let dataChunk: WavChunk | undefined;
  let offset = 12;
  let consumedEnd = 12;

  while (offset + 8 <= declaredEnd) {
    const id = readAscii(bytes, offset, 4);
    const size = readUint32(bytes, offset + 4);
    const bodyStart = offset + 8;
    if (bodyStart + size > bytes.length) throw new Error(`块 ${id} 声明长度越界`);
    chunks.push({ id, offset, size });
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: readUint16(bytes, bodyStart),
        channels: readUint16(bytes, bodyStart + 2),
        sampleRate: readUint32(bytes, bodyStart + 4),
        bitsPerSample: readUint16(bytes, bodyStart + 14),
      };
    } else if (id === "data") {
      dataChunk = { id, offset, size };
    } else if (id === "LIST" && size >= 4 && readAscii(bytes, bodyStart, 4) === "INFO") {
      parseInfoList(bytes, bodyStart + 4, bodyStart + size, metadata);
    }
    offset = bodyStart + size + (size & 1);
    consumedEnd = offset;
  }

  const trailingOffset = Math.min(consumedEnd, bytes.length);
  const trailing = bytes.length > trailingOffset ? bytes.slice(trailingOffset) : new Uint8Array(0);
  return { format, dataChunk, chunks, metadata, trailing, trailingOffset };
}

function readSample(bytes: Uint8Array, position: number, bitsPerSample: number) {
  switch (bitsPerSample) {
    case 8:
      return bytes[position]; // WAV 8-bit 为无符号 0..255
    case 16: {
      const value = bytes[position] | (bytes[position + 1] << 8);
      return (value << 16) >> 16;
    }
    case 24: {
      const value = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16);
      return (value << 8) >> 8;
    }
    case 32:
      return readUint32(bytes, position) | 0;
    default:
      throw new Error(`不支持的位深 ${bitsPerSample}`);
  }
}

// 解码整数 PCM 到每声道 Int32Array。仅支持 PCM（audioFormat 1 或 WAVE_FORMAT_EXTENSIBLE 0xFFFE）。
export function decodeWavSamples(bytes: Uint8Array): WavSamples {
  const container = parseWavChunks(bytes);
  if (!container.format) throw new Error("缺少 fmt 块");
  if (!container.dataChunk) throw new Error("缺少 data 块");
  const { audioFormat, channels, sampleRate, bitsPerSample } = container.format;
  if (audioFormat !== 1 && audioFormat !== 0xfffe) throw new Error("仅支持 PCM 整数编码");
  if (channels < 1) throw new Error("声道数无效");
  if (![8, 16, 24, 32].includes(bitsPerSample)) throw new Error(`不支持的位深 ${bitsPerSample}`);

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const dataStart = container.dataChunk.offset + 8;
  const frameCount = Math.floor(container.dataChunk.size / frameSize);
  const output = Array.from({ length: channels }, () => new Int32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameStart = dataStart + frame * frameSize;
    for (let channel = 0; channel < channels; channel += 1) {
      output[channel][frame] = readSample(bytes, frameStart + channel * bytesPerSample, bitsPerSample);
    }
  }
  return { sampleRate, bitDepth: bitsPerSample, channels: output };
}
