// 文本隐写分析：零宽字符/大小写变换/空白字符
import { detectFlags } from "./flagDetector";

export interface TextStegoResult {
  findings: TextStegoFinding[];
  candidates: TextStegoCandidate[];
}

export interface TextStegoFinding {
  id: string;
  severity: "high" | "suspicious" | "info";
  source: string;
  title: string;
  detail: string;
}

export interface TextStegoCandidate {
  id: string;
  source: string;
  value: string;
  flags: string[];
}

// ── Zero-width extraction ──
const ZW_CHARS: Record<number, string> = {
  0x200B: "ZWSP", 0x200C: "ZWNJ", 0x200D: "ZWJ",
  0x200E: "LRM", 0x200F: "RLM", 0xFEFF: "BOM",
};

export function extractZeroWidth(text: string): { found: string[]; count: number } {
  const found: string[] = [];
  let count = 0;
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (ZW_CHARS[code]) { found.push(ZW_CHARS[code]); count += 1; }
  }
  return { found, count };
}

export function zeroWidthToPayload(text: string): string {
  const bits: number[] = [];
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (code === 0x200B) bits.push(0);
    else if (code === 0x200C) bits.push(1);
  }
  if (bits.length < 8) return "";
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes[i / 8] = b;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return ""; }
}

// ── Case encoding ──
export function extractCaseEncoding(text: string): string {
  const bits: number[] = [];
  for (const c of text) {
    if (c >= "A" && c <= "Z") bits.push(1);
    else if (c >= "a" && c <= "z") bits.push(0);
  }
  if (bits.length < 8) return "";
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i + 8 <= bytes.length * 8; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes[i / 8] = b;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return ""; }
}

// ── Whitespace encoding (Tab=1, Space=0 → binary) ──
export function extractWhitespaceEncoding(text: string): string {
  const bits: number[] = [];
  for (const c of text) {
    if (c === "\t") bits.push(1);
    else if (c === " ") bits.push(0);
  }
  if (bits.length < 8) return "";
  const chunks: string[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    chunks.push(String.fromCharCode(parseInt(bits.slice(i, i + 8).join(""), 2)));
  }
  return chunks.join("");
}

// ── Trailing whitespace ──
export function detectTrailingWhitespace(text: string): string[] {
  const lines = text.split("\n");
  const findings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/([ \t]+)$/);
    if (match && match[1].length >= 2) {
      findings.push(`行 ${i + 1}: ${match[1].length} 个尾部空白字符`);
    }
  }
  return findings;
}

// ── Orchestrator ──
export function analyzeTextStego(text: string, prefixes: readonly string[], caseSensitive: boolean): TextStegoResult {
  const findings: TextStegoFinding[] = [];
  const candidates: TextStegoCandidate[] = [];

  // Zero-width
  const zw = extractZeroWidth(text);
  if (zw.count > 0) {
    findings.push({ id: "zw-detect", severity: "suspicious", source: "文本隐写", title: "检测到零宽字符", detail: `${zw.count} 个零宽字符 (${zw.found.join(", ")})` });
    const payload = zeroWidthToPayload(text);
    if (payload) {
      const flags = detectFlags(payload, prefixes, caseSensitive).map((h) => h.text);
      candidates.push({ id: "zw-payload", source: "零宽字符", value: payload, flags });
    }
  }

  // Case encoding
  const alphaOnly = text.replace(/[^A-Za-z]/g, "");
  if (alphaOnly.length >= 16) {
    const casePayload = extractCaseEncoding(text);
    if (casePayload) {
      const flags = detectFlags(casePayload, prefixes, caseSensitive).map((h) => h.text);
      if (flags.length > 0) {
        candidates.push({ id: "case-payload", source: "大小写编码", value: casePayload, flags });
        findings.push({ id: "case-detect", severity: "suspicious", source: "文本隐写", title: "字母大小写疑似编码数据", detail: `${alphaOnly.length} 个字母中包含二进制模式` });
      }
    }
  }

  // Trailing whitespace
  const trailing = detectTrailingWhitespace(text);
  if (trailing.length >= 3) {
    findings.push({ id: "trail-detect", severity: "suspicious", source: "文本隐写", title: "行尾空白字符", detail: trailing.slice(0, 5).join(" · ") });
  }

  return { findings, candidates };
}
