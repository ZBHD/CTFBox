import type { AudioLocalAnalysis } from "./audioTypes";
import type { StegoLocalAnalysis } from "./stegoTypes";
import type { ZipLocalAnalysis } from "./zipTypes";

export type LsbChannel = "R" | "G" | "B" | "A" | "I";
export type LsbBit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LsbSourceToken {
  channel: LsbChannel;
  bit: LsbBit;
}

export interface LsbScan {
  major: "row" | "column";
  x: "left-to-right" | "right-to-left";
  y: "top-to-bottom" | "bottom-to-top";
  serpentine: boolean;
  reversePixels: boolean;
}

export interface LsbExtractionParameters {
  sourceKind: "rgba" | "palette-index";
  sources: LsbSourceToken[];
  scan: LsbScan;
  layout: "pixel-interleaved" | "channel-block";
  packing: "msb-first" | "lsb-first";
  bitOffset: LsbBit;
  invertBits: boolean;
  reverseBytes: boolean;
  byteOffset: number;
  byteLimit?: number;
  terminator?: string;
}

export interface LsbImageSource {
  width: number;
  height: number;
  rgba: Uint8Array;
  paletteIndices?: Uint8Array;
}

export interface LsbProgress {
  stage: "presets" | "mixed" | "transforms" | "validate";
  tested: number;
  total: number;
  elapsedMs: number;
}

export interface LsbExtractedFile {
  name: string;
  mediaType: string;
  offset: number;
  bytes: Uint8Array;
  text?: string;
  children?: LsbExtractedFile[];
  warning?: string;
}

export interface LsbCandidate {
  id: string;
  score: number;
  parameters: LsbExtractionParameters;
  preview: string;
  mediaType: string;
  evidence: string[];
  bytes: Uint8Array;
  files: LsbExtractedFile[];
}

export interface LsbLocalAnalysis {
  kind: "lsb";
  status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed";
  fileName?: string;
  fileSize?: number;
  dataUrl?: string;
  source?: LsbImageSource;
  mode: "auto" | "manual";
  depth: "quick" | "deep";
  parameters: LsbExtractionParameters;
  progress?: LsbProgress;
  candidates: LsbCandidate[];
  selectedId?: string;
  error?: string;
}

export type LocalAnalysisState = LsbLocalAnalysis | StegoLocalAnalysis | ZipLocalAnalysis | AudioLocalAnalysis;
