import type { LsbExtractedFile } from "./lsbTypes";
import type { StegoMetadataEntry, StegoStringHit } from "./stegoTypes";

export type AudioSeverity = "high" | "suspicious" | "info";

export interface AudioFinding {
  id: string;
  severity: AudioSeverity;
  source: string;
  title: string;
  detail: string;
  offset?: number;
}

export interface AudioVisual {
  id: string;
  label: string;
  kind: "waveform" | "spectrogram";
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  detail?: string;
}

export interface AudioTrackInfo {
  format: string;
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  durationSeconds: number;
  lossy: boolean;
}

// 主线程解码得到的 PCM，传入 Worker 做后续 FFT/LSB。
export interface AudioPcm {
  sampleRate: number;
  bitDepth: number;
  lossy: boolean;
  channels: Int32Array[];
}

export interface AudioReport {
  track: AudioTrackInfo;
  findings: AudioFinding[];
  visuals: AudioVisual[];
  strings: StegoStringHit[];
  metadata: StegoMetadataEntry[];
  carvedFiles: LsbExtractedFile[];
}

export interface AudioOptions {
  waveform: boolean;
  spectrogram: boolean;
  lsb: boolean;
  channelDiff: boolean;
  metadata: boolean;
  strings: boolean;
  bitPlanes: number; // 抽多少低位
  channelMask: string; // 例 "LR"，L=左/首声道，R=右/次声道
  order: "interleaved" | "perChannel";
  fftSize: 256 | 512 | 1024;
  minimumStringLength: number;
}

export interface AudioProgress {
  stage: "decode" | "waveform" | "spectrogram" | "lsb" | "channelDiff" | "strings" | "metadata";
  completed: number;
  total: number;
}

export interface AudioLocalAnalysis {
  kind: "audio";
  status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed";
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  dataUrl?: string;
  bytes?: Uint8Array;
  pcm?: AudioPcm;
  options: AudioOptions;
  progress?: AudioProgress;
  report?: AudioReport;
  selectedTab: "overview" | "spectrogram" | "waveform" | "strings" | "files";
  error?: string;
}

export const DEFAULT_AUDIO_OPTIONS: AudioOptions = {
  waveform: true,
  spectrogram: true,
  lsb: true,
  channelDiff: true,
  metadata: true,
  strings: true,
  bitPlanes: 1,
  channelMask: "LR",
  order: "interleaved",
  fftSize: 512,
  minimumStringLength: 4,
};
