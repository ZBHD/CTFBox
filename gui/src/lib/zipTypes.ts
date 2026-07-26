export type ZipSeverity = "high" | "suspicious" | "info";

export type ZipMethod = "stored" | "deflate" | "aes" | "other";

export interface ZipEntryFinding {
  name: string;
  method: ZipMethod;
  localBit0: boolean;
  centralBit0: boolean;
  severity: ZipSeverity;
  verdict: string;
  crcVerified: boolean;
  localGpOffset: number;
  centralGpOffset: number;
  flagHits: string[];
}

export interface ZipReport {
  entryCount: number;
  entries: ZipEntryFinding[];
  repairable: number;
  flagHits: string[];
}

export interface ZipOptions {
  checkLocalHeader: boolean;
  checkCentralDirectory: boolean;
  repairMode: "repair" | "report";
}

export interface ZipProgress {
  stage: "parse" | "verify";
  completed: number;
  total: number;
}

export interface ZipLocalAnalysis {
  kind: "zip";
  status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed";
  fileName?: string;
  fileSize?: number;
  bytes?: Uint8Array;
  options: ZipOptions;
  progress?: ZipProgress;
  report?: ZipReport;
  error?: string;
}

export const DEFAULT_ZIP_OPTIONS: ZipOptions = {
  checkLocalHeader: true,
  checkCentralDirectory: true,
  repairMode: "repair",
};
