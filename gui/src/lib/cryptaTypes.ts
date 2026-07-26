export type CryptaSeverity = "high" | "suspicious" | "info";

export interface CryptaFinding {
  id: string;
  severity: CryptaSeverity;
  source: string;
  title: string;
  detail: string;
}

export interface CryptaReport {
  inputType: string;
  detectedType?: string;
  findings: CryptaFinding[];
  plaintextCandidates: string[];
  attackDetails: string[];
}

export interface CryptaOptions {
  classical: boolean;
  rsa: boolean;
  aes: boolean;
  hash: boolean;
  prng: boolean;
  lattice: boolean;
}

export const DEFAULT_CRYPTA_OPTIONS: CryptaOptions = {
  classical: true,
  rsa: true,
  aes: true,
  hash: true,
  prng: true,
  lattice: false,
};

export interface CryptaProgress {
  stage: "classical" | "rsa" | "aes" | "hash" | "prng" | "lattice";
  completed: number;
  total: number;
}
