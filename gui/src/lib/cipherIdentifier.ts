// 基于统计特征的密码类型自动识别
export interface CipherMatch {
  type: string;
  score: number;
  reasoning: string;
}

function charClassRatios(text: string) {
  const total = text.length || 1;
  let alpha = 0;
  let digit = 0;
  let hexChars = 0;
  let binaryChars = 0;
  let octalChars = 0;
  const withoutSpaces = text.replace(/\s/g, "");
  const trimmedLen = withoutSpaces.length || 1;
  for (const c of withoutSpaces) {
    if (/[A-Za-z]/.test(c)) alpha += 1;
    if (/[0-9]/.test(c)) digit += 1;
    if (/[0-9a-fA-F]/.test(c)) hexChars += 1;
    if (/[01]/.test(c)) binaryChars += 1;
    if (/[0-7]/.test(c)) octalChars += 1;
  }
  return {
    alphaRatio: alpha / trimmedLen,
    digitRatio: digit / trimmedLen,
    hexRatio: hexChars / trimmedLen,
    binaryRatio: binaryChars / trimmedLen,
    octalRatio: octalChars / trimmedLen,
    total: trimmedLen,
  };
}

function indexOfCoincidence(text: string): number {
  const upper = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (upper.length < 2) return 0;
  const freq = new Map<string, number>();
  for (const c of upper) freq.set(c, (freq.get(c) ?? 0) + 1);
  let sum = 0;
  for (const n of freq.values()) sum += n * (n - 1);
  return sum / (upper.length * (upper.length - 1));
}

export function identifyCipherType(text: string): CipherMatch[] {
  if (!text.trim()) return [];
  const matches: CipherMatch[] = [];
  const ratios = charClassRatios(text);
  const withoutSpaces = text.replace(/\s/g, "");
  const ic = indexOfCoincidence(text);

  if (ratios.binaryRatio > 0.8 && /[01]/.test(withoutSpaces)) {
    matches.push({ type: "binary", score: 90, reasoning: "高比例 0/1 字符" });
  }
  if (ratios.octalRatio > 0.8 && /^[0-7\s]+$/.test(withoutSpaces)) {
    matches.push({ type: "octal", score: 85, reasoning: "仅含 0-7 数字" });
  }
  if (ratios.hexRatio > 0.85 && withoutSpaces.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(withoutSpaces)) {
    matches.push({ type: "hex", score: 88, reasoning: "纯十六进制且长度为偶数" });
  }
  if (/^[A-Z2-7]+=*$/.test(withoutSpaces) && withoutSpaces.length >= 8) {
    matches.push({ type: "base32", score: 82, reasoning: "字符集匹配 Base32" });
  }
  if (/^[A-Za-z0-9+/]+=*$/.test(withoutSpaces) && withoutSpaces.length % 4 === 0 && withoutSpaces.length >= 4) {
    matches.push({ type: "base64", score: 85, reasoning: "字符集匹配 Base64 且长度为 4 的倍数" });
  }
  if (/^[.\-/\s|]+$/.test(text.trim()) && text.includes(".") && text.includes("-")) {
    matches.push({ type: "morse", score: 90, reasoning: "仅含点/划/分隔符" });
  }
  if (ratios.alphaRatio > 0.75 && ic > 0.05) {
    matches.push({ type: "substitution", score: 70, reasoning: `高 IC 值 (${ic.toFixed(3)})，疑似简单替换密码` });
    matches.push({ type: "caesar", score: 65, reasoning: "简单替换密码的常见子类型" });
    matches.push({ type: "atbash", score: 50, reasoning: "Atbash 是替换密码的特例" });
  }
  if (ratios.alphaRatio > 0.7 && ic < 0.045 && ic > 0.01) {
    matches.push({ type: "vigenere", score: 65, reasoning: `低 IC 值 (${ic.toFixed(3)})，疑似多表替换` });
  }
  if (ratios.alphaRatio > 0.6 && ic > 0.04 && ic <= 0.055) {
    matches.push({ type: "railfence", score: 45, reasoning: "中等 IC 值，可能为换位密码" });
    matches.push({ type: "transposition", score: 45, reasoning: "IC 值与换位密码相符" });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}
