// PRNG 状态恢复：LCG / MT19937 / Java Random

export interface LcgResult {
  multiplier: number;
  increment: number;
  modulus: number;
  recovered: boolean;
}

// 给定 3 个连续 LCG 输出，恢复参数 (modulus 需已知或从更大序列推断)
export function recoverLcg(values: number[], modulus?: number): LcgResult {
  if (values.length < 3) return { multiplier: 0, increment: 0, modulus: 0, recovered: false };

  const mod = modulus ?? (1 << 31);
  const [x0, x1, x2] = values;
  // x1 = (a*x0 + c) mod m, x2 = (a*x1 + c) mod m
  // x2 - x1 = a*(x1 - x0) mod m
  const dx10 = ((x1 - x0) % mod + mod) % mod;
  const dx21 = ((x2 - x1) % mod + mod) % mod;

  // a = dx21 * inv(dx10) mod m
  const a = modInverseBigInt(BigInt(dx10), BigInt(mod));
  if (a === null) return { multiplier: 0, increment: 0, modulus: mod, recovered: false };

  const multiplier = Number(a);
  // c = x1 - a*x0 mod m
  const inc = Number((((BigInt(x1) - BigInt(multiplier) * BigInt(x0)) % BigInt(mod)) + BigInt(mod)) % BigInt(mod));

  // Verify with x2
  const predicted = (multiplier * x1 + inc) % mod;
  if (predicted === x2) {
    return { multiplier, increment: inc, modulus: mod, recovered: true };
  }
  return { multiplier, increment: inc, modulus: mod, recovered: false };
}

function modInverseBigInt(a: bigint, m: bigint): bigint | null {
  let [r0, r1] = [a, m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) return null;
  return ((s0 % m) + m) % m;
}

// ── MT19937 ──
const MT_N = 624;
const MT_M = 397;

function untemper(y: number): number {
  // Reverse y ^= y >> 18
  let z = y ^ (y >>> 18);
  // Reverse y ^= (y << 15) & 0xefc60000
  z ^= ((z << 15) & 0xefc60000);
  // Reverse y ^= (y << 7) & 0x9d2c5680
  let tmp = z;
  tmp = z ^ ((tmp << 7) & 0x9d2c5680);
  tmp = z ^ ((tmp << 7) & 0x9d2c5680);
  tmp = z ^ ((tmp << 7) & 0x9d2c5680);
  tmp = z ^ ((tmp << 7) & 0x9d2c5680);
  z = tmp;
  // Reverse y ^= y >> 11
  tmp = z ^ (z >>> 11);
  z = z ^ (tmp >>> 11);
  return z >>> 0;
}

export class Mt19937 {
  private mt: Uint32Array;
  private index: number;

  constructor(seed?: number) {
    this.mt = new Uint32Array(MT_N);
    this.index = MT_N;
    if (seed !== undefined) {
      this.mt[0] = seed >>> 0;
      for (let i = 1; i < MT_N; i++) {
        this.mt[i] = (1812433253 * (this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0;
      }
    }
  }

  // Clone state from 624 known outputs
  static fromOutputs(outputs: number[]): Mt19937 | null {
    if (outputs.length < MT_N) return null;
    const mt = new Mt19937();
    for (let i = 0; i < MT_N; i++) {
      mt.mt[i] = untemper(outputs[i]);
    }
    mt.index = MT_N;
    return mt;
  }

  next(): number {
    if (this.index >= MT_N) this.twist();
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  private twist() {
    for (let i = 0; i < MT_N; i++) {
      const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % MT_N] & 0x7fffffff);
      this.mt[i] = (this.mt[(i + MT_M) % MT_N] ^ (y >>> 1)) >>> 0;
      if (y & 1) this.mt[i] ^= 0x9908b0df;
    }
    this.index = 0;
  }
}

// ── Java Random (48-bit LCG) ──
const JAVA_MULT = 0x5DEECE66Dn;
const JAVA_ADD = 0xBn;
const JAVA_MOD = 1n << 48n;

export function javaRandomSeedFromInts(v1: number, v2: number): number | null {
  // nextInt() = (seed >>> 16) then seed = (seed*m + a) % 2^48
  // v1 = (seed0 >>> 16), v2 = (seed1 >>> 16)
  // seed1 = (seed0 * m + a) % 2^48
  // We need to brute force lower 16 bits
  const target1 = BigInt(v1 >>> 0);
  const target2 = BigInt(v2 >>> 0);

  for (let low = 0n; low < (1n << 16n); low++) {
    const seed0 = (target1 << 16n) | low;
    const seed1 = (seed0 * JAVA_MULT + JAVA_ADD) & (JAVA_MOD - 1n);
    const nextInt = seed1 >> 16n;
    if (nextInt === target2) return Number(seed0 ^ (JAVA_MULT));
  }
  return null;
}
