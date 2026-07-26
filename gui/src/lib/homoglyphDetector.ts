// Unicode 同形字与零宽字符隐写检测
const ZERO_WIDTH_CHARS = new Set([
  0x200B, // ZWSP
  0x200C, // ZWNJ
  0x200D, // ZWJ
  0x200E, // LRM
  0x200F, // RLM
  0xFEFF, // BOM
  0x00AD, // soft-hyphen
  0x2060, // word-joiner
  0x2061, // function application
  0x2062, // invisible times
  0x2063, // invisible separator
  0x2064, // invisible plus
]);

export interface HomoglyphResult {
  detected: boolean;
  reason: string;
}

export interface ZeroWidthResult {
  detected: boolean;
  count: number;
}

export function detectHomoglyphs(text: string): HomoglyphResult {
  let latin = 0;
  let cyrillic = 0;
  let greek = 0;
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (code >= 0x0041 && code <= 0x007A) latin += 1; // A-Z, a-z
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic += 1;
    else if (code >= 0x0370 && code <= 0x03FF) greek += 1;
  }
  const mixed = [latin > 0, cyrillic > 0, greek > 0].filter(Boolean).length;
  if (mixed >= 2) {
    return { detected: true, reason: `检测到 ${mixed} 种文字系统混合（拉丁/西里尔/希腊）` };
  }
  return { detected: false, reason: "" };
}

export function detectZeroWidth(text: string): ZeroWidthResult {
  let count = 0;
  for (const c of text) {
    if (ZERO_WIDTH_CHARS.has(c.codePointAt(0) ?? 0)) count += 1;
  }
  return { detected: count > 0, count };
}

export function extractZeroWidthPayload(text: string): string {
  const bits: number[] = [];
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (code === 0x200B) bits.push(0); // ZWSP → 0
    else if (code === 0x200C) bits.push(1); // ZWNJ → 1
  }
  if (bits.length < 8) return "";
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[i + bit];
    bytes.push(byte);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return "";
  }
}
