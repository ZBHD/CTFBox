import type { PcapReport } from "./pcapAnalyzer";

export interface PcapLocalAnalysis {
  kind: "pcap";
  status: "idle" | "loading" | "running" | "cancelled" | "completed" | "failed";
  fileName?: string;
  fileSize?: number;
  bytes?: Uint8Array;
  report?: PcapReport;
  error?: string;
}
