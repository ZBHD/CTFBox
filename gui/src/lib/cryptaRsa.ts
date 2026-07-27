// RSA 参数分析与攻击
export interface RsaParams {
  n: bigint;
  e: bigint;
  d?: bigint;
  p?: bigint;
  q?: bigint;
}

export interface RsaAttack {
  name: string;
  recovered: boolean;
  plaintext?: bigint;
  factors?: [bigint, bigint];
  privateKey?: bigint;
  detail: string;
}

// ── PEM/DER 解析 ──
export function parseRsaPem(pem: string): RsaParams | null {
  // Check for hex/colon format first before trying PEM
  if (/[nNeEdDpPqQ]\s*[:=]/.test(pem)) {
    return parseRsaHex(pem);
  }
  const b64 = pem.replace(/-----(BEGIN|END).*?-----/g, "").replace(/\s/g, "");
  try {
    const binary = globalThis.atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return parseRsaDer(bytes);
  } catch {
    return null;
  }
}

function parseRsaDer(bytes: Uint8Array): RsaParams | null {
  // Minimal ASN.1 DER parser for RSA private key (PKCS#1)
  // SEQUENCE { INTEGER n, INTEGER e, INTEGER d, INTEGER p, INTEGER q, ... }
  try {
    let pos = 0;
    // Skip SEQUENCE header (0x30 + length)
    if (bytes[pos] !== 0x30) {
      // Try raw "n:e" or "n,e,d,p,q" hex format
      return parseRsaHex(new TextDecoder().decode(bytes));
    }
    pos += 1;
    const seqLen = readDerLength(bytes, pos);
    pos = seqLen.pos;

    // Read INTEGERs
    const ints: bigint[] = [];
    for (let i = 0; i < 8 && pos < bytes.length; i++) {
      if (bytes[pos] !== 0x02) break;
      pos += 1;
      const len = readDerLength(bytes, pos);
      pos = len.pos;
      ints.push(readDerInteger(bytes, pos, len.value));
      pos += len.value;
    }

    return {
      n: ints[0] ?? 0n,
      e: ints[1] ?? 0n,
      d: ints[2],
      p: ints[3],
      q: ints[4],
    };
  } catch {
    return null;
  }
}

function parseRsaHex(text: string): RsaParams | null {
  // Split by line first to avoid "n:123\ne:456" merging into "n:123e:456"
  const params: Record<string, bigint> = {};
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const match = line.match(/^\s*([nNeEdDpPqQ])\s*[=:]\s*(0x[0-9a-fA-F]+|[0-9a-fA-F]+|[0-9]+)\s*$/i);
    if (match) {
      const key = match[1].toLowerCase();
      let raw = match[2];
      // Detect hex (contains a-f, starts with 0x, or is all hex-looking) vs decimal
      const isHex = /^0x/i.test(raw) || /[a-fA-F]/.test(raw);
      const value = isHex ? BigInt(raw.toLowerCase()) : BigInt(raw);
      if (value > 0n) params[key] = value;
    }
  }
  if (params.n && params.e) {
    return { n: params.n, e: params.e, d: params.d, p: params.p, q: params.q };
  }
  // Fallback: try old split-by-delimiter approach for single-line format
  const parts = text.replace(/\s/g, "").split(/[:,]/);
  const nums: bigint[] = [];
  for (const p of parts) {
    try {
      const isHexPrefix = /^0x/i.test(p);
      const clean = p.replace(/^0x/i, "");
      if (!/[0-9a-fA-F]/.test(clean) || clean.length > 2048) continue;
      if (clean.length < 2 && !isHexPrefix) continue; // reject single-char param names
      // Detect decimal (pure [0-9]) vs hex (has 0x prefix or af chars)
      const value = (isHexPrefix || /[a-fA-F]/.test(clean)) ? BigInt("0x" + clean) : BigInt(clean);
      if (value > 0n) nums.push(value);
    } catch {
      // skip non-numeric
    }
  }
  if (nums.length < 2) return null;
  return { n: nums[0], e: nums[1], d: nums[2], p: nums[3], q: nums[4] };
}

function readDerLength(bytes: Uint8Array, pos: number): { value: number; pos: number } {
  const b = bytes[pos];
  if (b < 0x80) return { value: b, pos: pos + 1 };
  const numBytes = b & 0x7f;
  let value = 0;
  for (let i = 0; i < numBytes; i++) value = (value << 8) | bytes[pos + 1 + i];
  return { value, pos: pos + 1 + numBytes };
}

function readDerInteger(bytes: Uint8Array, pos: number, len: number): bigint {
  let value = 0n;
  for (let i = 0; i < len; i++) value = (value << 8n) | BigInt(bytes[pos + i]);
  return value;
}

// ── Wiener 攻击 ──
export function wienerAttack(n: bigint, e: bigint): RsaAttack {
  // e/n 连分数展开 → 检查每个收敛的分母是否为 d
  const cf = continuedFraction(e, n);
  for (const conv of convergents(cf)) {
    const d = conv[1];
    if (d <= 0n || d >= n) continue;
    if ((e * d - 1n) % conv[0] !== 0n) continue;
    const phi = (e * d - 1n) / conv[0];
    // Solve: p^2 - (n - phi + 1)p + n = 0
    const b = n - phi + 1n;
    const discriminant = b * b - 4n * n;
    if (discriminant < 0n) continue;
    const sqrtD = bigIntSqrt(discriminant);
    if (sqrtD * sqrtD !== discriminant) continue;
    const p = (b + sqrtD) / 2n;
    const q = (b - sqrtD) / 2n;
    if (p * q === n) {
      return { name: "Wiener 攻击", recovered: true, factors: [p, q], privateKey: d, detail: `d = ${d}` };
    }
  }
  return { name: "Wiener 攻击", recovered: false, detail: "未找到满足条件的 d" };
}

// ── 共模攻击 ──
export function commonModulusAttack(n: bigint, e1: bigint, c1: bigint, e2: bigint, c2: bigint): RsaAttack {
  const [g, s1, s2] = extendedGcd(e1, e2);
  if (g !== 1n) return { name: "共模攻击", recovered: false, detail: `gcd(e1,e2)=${g}，攻击失败` };
  let m: bigint;
  if (s1 < 0n) {
    const invC1 = modInv(c1, n);
    if (!invC1) return { name: "共模攻击", recovered: false, detail: "c1 模逆不存在" };
    m = modPow(invC1, -s1, n) * modPow(c2, s2, n) % n;
  } else if (s2 < 0n) {
    const invC2 = modInv(c2, n);
    if (!invC2) return { name: "共模攻击", recovered: false, detail: "c2 模逆不存在" };
    m = modPow(c1, s1, n) * modPow(invC2, -s2, n) % n;
  } else {
    m = modPow(c1, s1, n) * modPow(c2, s2, n) % n;
  }
  return { name: "共模攻击", recovered: true, plaintext: m, detail: `s1=${s1}, s2=${s2}` };
}

// ── 小指数攻击 (e=3) ──
export function smallExponentAttack(c: bigint, e: bigint, n: bigint): RsaAttack {
  if (e > 65537n) return { name: "小指数攻击", recovered: false, detail: `e=${e} 过大` };
  // m^e = c + k*n, try small k
  for (let k = 0n; k < 1000n; k++) {
    const candidate = c + k * n;
    const root = bigIntNthRoot(candidate, Number(e));
    if (root !== null && modPow(root, e, n) === c) {
      return { name: "小指数攻击", recovered: true, plaintext: root, detail: `k=${k}` };
    }
  }
  return { name: "小指数攻击", recovered: false, detail: "未找到整数 e 次根" };
}

// ── Fermat 分解 ──
export function fermatFactor(n: bigint, maxIter = 1_000_000): RsaAttack {
  let a = bigIntSqrt(n) + 1n;
  for (let i = 0; i < maxIter; i++) {
    const b2 = a * a - n;
    if (b2 < 0n) { a += 1n; continue; }
    const b = bigIntSqrt(b2);
    if (b * b === b2) {
      const p = a - b;
      const q = a + b;
      if (p * q === n) return { name: "Fermat 分解", recovered: true, factors: [p, q], detail: `iterations=${i}` };
    }
    a += 1n;
  }
  return { name: "Fermat 分解", recovered: false, detail: `超过 ${maxIter} 次迭代` };
}

// ── BigInt 工具 ──
function continuedFraction(num: bigint, den: bigint): bigint[] {
  const result: bigint[] = [];
  while (den !== 0n) {
    result.push(num / den);
    [num, den] = [den, num % den];
  }
  return result;
}

function convergents(cf: bigint[]): [bigint, bigint][] {
  const result: [bigint, bigint][] = [];
  let h0 = 0n, h1 = 1n, k0 = 1n, k1 = 0n;
  for (const a of cf) {
    const h = a * h1 + h0;
    const k = a * k1 + k0;
    result.push([h, k]);
    [h0, h1] = [h1, h];
    [k0, k1] = [k1, k];
  }
  return result;
}

function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = extendedGcd(b, a % b);
  return [g, y, x - (a / b) * y];
}

function modInv(a: bigint, m: bigint): bigint | null {
  const [g, x] = extendedGcd(a, m);
  if (g !== 1n) return null;
  return ((x % m) + m) % m;
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    e >>= 1n;
  }
  return result;
}

function bigIntSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + n / x) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function bigIntNthRoot(n: bigint, root: number): bigint | null {
  if (root === 1) return n;
  let low = 0n;
  let high = 1n;
  while (high ** BigInt(root) < n) high *= 2n;
  while (low <= high) {
    const mid = (low + high) / 2n;
    const pow = mid ** BigInt(root);
    if (pow === n) return mid;
    if (pow < n) low = mid + 1n;
    else high = mid - 1n;
  }
  return null;
}
