import type { LsbExtractedFile } from "./lsbTypes";

export type StegoSeverity = "high" | "suspicious" | "info";

export interface StegoOptions {
  metadata: boolean;
  structure: boolean;
  trailing: boolean;
  strings: boolean;
  visuals: boolean;
  dct: boolean;
  frequency: boolean;
  minimumStringLength: number;
  fftSize: 128 | 256 | 512;
}

export interface StegoPixelSource {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface StegoFinding {
  id: string;
  severity: StegoSeverity;
  source: string;
  title: string;
  detail: string;
  offset?: number;
}

export interface StegoSection {
  type: string;
  name: string;
  offset: number;
  length: number;
  status?: "ok" | "warning" | "error";
  detail?: string;
}

export interface StegoMetadataEntry {
  group: string;
  key: string;
  value: string;
  offset?: number;
}

export interface StegoStringHit {
  encoding: "ASCII" | "UTF-8" | "UTF-16LE" | "UTF-16BE" | "GB18030";
  offset: number;
  text: string;
  decodedFrom?: "Base64" | "Hex" | "URL";
  flags: string[];
}

export interface StegoVisual {
  id: string;
  label: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  detail?: string;
}

export interface JpegDctReport {
  supported: boolean;
  reason?: string;
  width?: number;
  height?: number;
  components?: number;
  blocks?: number;
  restartInterval?: number;
  zeroAcRatio?: number;
  oddRatios?: number[];
  coefficientCounts?: number[];
  warnings: string[];
}

export interface StegoReport {
  format: string;
  findings: StegoFinding[];
  sections: StegoSection[];
  metadata: StegoMetadataEntry[];
  strings: StegoStringHit[];
  visuals: StegoVisual[];
  dct?: JpegDctReport;
  carvedFiles: LsbExtractedFile[];
  logicalEnd?: number;
}

export interface StegoProgress {
  stage: "structure" | "metadata" | "strings" | "visuals" | "dct" | "frequency";
  completed: number;
  total: number;
}

export interface StegoLocalAnalysis {
  kind: "stego";
  status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed";
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  dataUrl?: string;
  bytes?: Uint8Array;
  pixels?: StegoPixelSource;
  options: StegoOptions;
  progress?: StegoProgress;
  report?: StegoReport;
  selectedTab: "overview" | "metadata" | "structure" | "strings" | "visuals" | "dct" | "files";
  error?: string;
}
