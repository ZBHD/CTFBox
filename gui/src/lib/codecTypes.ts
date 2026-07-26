export type CodecSeverity = "high" | "suspicious" | "info";

export interface CodecFinding {
  id: string;
  severity: CodecSeverity;
  source: string;
  title: string;
  detail: string;
  offset?: number;
}

export interface CodecCandidate {
  id: string;
  source: string;
  label: string;
  value: string;
  confidence: "high" | "candidate";
  detail: string;
  flags: string[];
}

export interface CodecReport {
  findings: CodecFinding[];
  candidates: CodecCandidate[];
  decodedTexts: string[];
}

export interface CodecOptions {
  classical: boolean;
  morse: boolean;
  esolang: boolean;
  customBase: boolean;
  cjk: boolean;
  homoglyph: boolean;
  recursiveDecode: boolean;
  maxRecursiveDepth: number;
}

export const DEFAULT_CODEC_OPTIONS: CodecOptions = {
  classical: true,
  morse: true,
  esolang: true,
  customBase: true,
  cjk: true,
  homoglyph: true,
  recursiveDecode: true,
  maxRecursiveDepth: 3,
};

export interface CodecProgress {
  stage: "classical" | "morse" | "esolang" | "customBase" | "cjk" | "homoglyph" | "recursive";
  completed: number;
  total: number;
}
