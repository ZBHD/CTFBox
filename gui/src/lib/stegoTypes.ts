import type { LsbExtractedFile } from "./lsbTypes";

export type StegoSeverity = "high" | "suspicious" | "info";

export interface StegoOptions {
  metadata: boolean;
  structure: boolean;
  channels: boolean;
  dimensions: boolean;
  recursiveCarving: boolean;
  trailing: boolean;
  strings: boolean;
  visuals: boolean;
  dct: boolean;
  frequency: boolean;
  ocr: boolean;
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

export interface StegoChannelCandidate {
  id: string;
  source: string;
  label: string;
  value: string;
  confidence: "high" | "candidate";
  detail: string;
  flags: string[];
}

export interface StegoRepairCandidate {
  id: string;
  format: "PNG" | "BMP" | "GIF" | "JPEG";
  label: string;
  width: number;
  height: number;
  confidence: "exact" | "candidate";
  detail: string;
  bytes: Uint8Array;
}

export interface StegoOcrResult {
  sourceId: string;
  sourceLabel: string;
  text: string;
  confidence: number;
  flags: string[];
  error?: string;
}

export interface JpegDctReport {
  supported: boolean;
  reason?: string;
  width?: number;
  height?: number;
  components?: number;
  blocks?: number;
  decodedMcus?: number;
  mcuWidth?: number;
  mcuHeight?: number;
  blocksPerMcu?: number;
  entropyBytesRemaining?: number;
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
  channels?: StegoChannelCandidate[];
  repairs?: StegoRepairCandidate[];
  ocr?: StegoOcrResult[];
  logicalEnd?: number;
}

export interface StegoProgress {
  stage: "structure" | "channels" | "dimensions" | "carving" | "metadata" | "strings" | "visuals" | "dct" | "frequency" | "ocr";
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
  batchParts?: Array<{ name: string; format: string; width: number; height: number }>;
  options: StegoOptions;
  progress?: StegoProgress;
  report?: StegoReport;
  selectedTab: "overview" | "channels" | "repairs" | "metadata" | "structure" | "strings" | "visuals" | "ocr" | "dct" | "files";
  error?: string;
}
