// 古典密码引擎：Caesar、Vigenère、Atbash、ROT13、ROT47、栅栏、仿射
export interface DecryptResult {
  text: string;
  method: string;
  params: Record<string, number>;
  score: number;
  shift?: number;
  rails?: number;
}

// ── 工具函数 ──
function mod26(value: number): number {
  return ((value % 26) + 26) % 26;
}

function modInverse(a: number, m: number): number {
  let [r0, r1] = [a, m];
  let [s0, s1] = [1, 0];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return mod26(s0);
}

// ── Caesar ──
export function caesarDecrypt(text: string, shift: number): string {
  const result: string[] = [];
  for (const c of text) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) result.push(String.fromCharCode(((code - 65 - shift + 26) % 26) + 65));
    else if (code >= 97 && code <= 122) result.push(String.fromCharCode(((code - 97 - shift + 26) % 26) + 97));
    else result.push(c);
  }
  return result.join("");
}

export function caesarBruteforce(text: string, prefixes: readonly string[], caseSensitive: boolean): DecryptResult[] {
  const results: DecryptResult[] = [];
  for (let shift = 0; shift < 26; shift += 1) {
    const decoded = caesarDecrypt(text, shift);
    if (decoded === text) continue;
    let score = 0;
    for (const prefix of prefixes) {
      if (prefix.length > 0) {
        const flag = `${prefix}{`;
        if (caseSensitive ? decoded.includes(flag) : decoded.toLowerCase().includes(flag.toLowerCase())) score += 100;
        if (caseSensitive ? decoded.includes(prefix) : decoded.toLowerCase().includes(prefix.toLowerCase())) score += 10;
      }
    }
    if (score > 0 || shift < 5) {
      results.push({ text: decoded, method: `Caesar ROT${shift}`, params: { shift }, score, shift });
    }
  }
  results.sort((a, b) => b.score - a.score || a.shift! - b.shift!);
  return results;
}

// ── Vigenère ──
export function vigenereDecrypt(text: string, key: string): string {
  const keyUpper = key.toUpperCase().replace(/[^A-Z]/g, "");
  if (!keyUpper) return text;
  const result: string[] = [];
  let ki = 0;
  for (const c of text) {
    const code = c.charCodeAt(0);
    const k = keyUpper.charCodeAt(ki % keyUpper.length) - 65;
    if (code >= 65 && code <= 90) {
      result.push(String.fromCharCode(mod26(code - 65 - k) + 65));
      ki += 1;
    } else if (code >= 97 && code <= 122) {
      result.push(String.fromCharCode(mod26(code - 97 - k) + 97));
      ki += 1;
    } else {
      result.push(c);
    }
  }
  return result.join("");
}

// ── Atbash ──
export function atbashTransform(text: string): string {
  const result: string[] = [];
  for (const c of text) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) result.push(String.fromCharCode(90 - (code - 65)));
    else if (code >= 97 && code <= 122) result.push(String.fromCharCode(122 - (code - 97)));
    else result.push(c);
  }
  return result.join("");
}

// ── ROT13 ──
export function rot13(text: string): string {
  return caesarDecrypt(text, 13);
}

// ── ROT47 ──
export function rot47(text: string): string {
  const result: string[] = [];
  for (const c of text) {
    const code = c.charCodeAt(0);
    if (code >= 33 && code <= 126) result.push(String.fromCharCode(((code - 33 + 47) % 94) + 33));
    else result.push(c);
  }
  return result.join("");
}

// ── 栅栏密码 (Rail Fence) ──
export function railFenceDecrypt(text: string, rails: number, offset = 0): string {
  if (rails <= 1 || text.length <= 1) return text;
  const n = text.length;
  const cycle = (rails - 1) * 2 || 2;
  // Build pattern: which rail each position belongs to, starting at given offset
  const pattern: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const pos = (i + offset) % cycle;
    pattern.push(pos <= rails - 1 ? pos : cycle - pos);
  }
  // Group positions by rail
  const fence: number[][] = Array.from({ length: rails }, () => []);
  for (let i = 0; i < n; i += 1) fence[pattern[i]].push(i);
  // Read off by rail order
  const positions: number[] = [];
  for (const row of fence) positions.push(...row);
  const result = new Array(n);
  for (let i = 0; i < n; i += 1) result[positions[i]] = text[i];
  return result.join("");
}

export function railFenceBruteforce(text: string, _prefixes: readonly string[], _caseSensitive: boolean): DecryptResult[] {
  const results: DecryptResult[] = [];
  const maxRails = Math.min(text.length - 1, 20);
  for (let rails = 2; rails <= maxRails; rails += 1) {
    for (let offset = 0; offset < rails; offset += 1) {
      const decoded = railFenceDecrypt(text, rails, offset);
      if (decoded !== text) {
        results.push({ text: decoded, method: `${rails} 栏栅栏`, params: { rails, offset }, score: rails * -1, rails });
      }
    }
  }
  return results;
}

// ── 仿射密码 (Affine) ──
export function affineDecrypt(text: string, a: number, b: number): string {
  const aInv = modInverse(a, 26);
  const result: string[] = [];
  for (const c of text) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      result.push(String.fromCharCode(mod26(aInv * (code - 65 - b)) + 65));
    } else if (code >= 97 && code <= 122) {
      result.push(String.fromCharCode(mod26(aInv * (code - 97 - b)) + 97));
    } else {
      result.push(c);
    }
  }
  return result.join("");
}

export function affineBruteforce(text: string, _prefixes: readonly string[], _caseSensitive: boolean): DecryptResult[] {
  const results: DecryptResult[] = [];
  const validA = [1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25]; // gcd(a,26)=1
  for (const a of validA) {
    for (let b = 0; b < 26; b += 1) {
      const decoded = affineDecrypt(text, a, b);
      if (decoded !== text) {
        results.push({ text: decoded, method: `仿射 a=${a} b=${b}`, params: { a, b }, score: 0 });
      }
    }
  }
  return results;
}
