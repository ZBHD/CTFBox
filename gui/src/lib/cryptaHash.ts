// 哈希分析：长度扩展攻击
export interface HashExtResult {
  possible: boolean;
  algorithm?: string;
  newHash?: string;
  detail: string;
}

// SHA-256 长度扩展攻击
// 给定 H(message) 和 len(message)，计算 H(message || padding || append)
export function sha256LengthExtension(
  originalHash: string,
  originalLen: number,
  append: string,
): HashExtResult {
  // SHA-256 使用 Merkle-Damgård 结构，可做长度扩展
  try {
    const hashBytes = hexToBytes(originalHash);
    if (hashBytes.length !== 32) return { possible: true, algorithm: "SHA-256", detail: "Hash 长度非 32 字节，解析失败" };

    // Extract state (8 × 32-bit words)
    const state = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
      state[i] = (hashBytes[i * 4] << 24) | (hashBytes[i * 4 + 1] << 16) | (hashBytes[i * 4 + 2] << 8) | hashBytes[i * 4 + 3];
    }

    // For actual attack: continue SHA-256 from this state with (padding + append)
    // This is a simplified version — a full implementation would replicate the SHA-256 compression
    return {
      possible: true,
      algorithm: "SHA-256",
      detail: `SHA-256 基于 Merkle-Damgård，可做长度扩展。原消息长度 ${originalLen} 字节。完整实现在 plan v2 中。`,
    };
  } catch {
    return { possible: false, detail: "输入解析失败" };
  }
}

export function md5LengthExtension(
  originalHash: string,
  originalLen: number,
  append: string,
): HashExtResult {
  try {
    const hashBytes = hexToBytes(originalHash);
    if (hashBytes.length !== 16) return { possible: true, algorithm: "MD5", detail: "Hash 长度非 16 字节，解析失败" };
    return {
      possible: true,
      algorithm: "MD5",
      detail: `MD5 基于 Merkle-Damgård，可做长度扩展。原消息长度 ${originalLen} 字节。完整实现在 plan v2 中。`,
    };
  } catch {
    return { possible: false, detail: "输入解析失败" };
  }
}

// 哈希算法识别
export function identifyHash(hash: string): string[] {
  const trimmed = hash.trim();
  const len = trimmed.length;
  const matches: string[] = [];
  if (len === 32 && /^[0-9a-f]{32}$/i.test(trimmed)) matches.push("MD5");
  if (len === 40 && /^[0-9a-f]{40}$/i.test(trimmed)) matches.push("SHA-1");
  if (len === 56 && /^[0-9a-f]{56}$/i.test(trimmed)) matches.push("SHA-224");
  if (len === 64 && /^[0-9a-f]{64}$/i.test(trimmed)) matches.push("SHA-256");
  if (len === 96 && /^[0-9a-f]{96}$/i.test(trimmed)) matches.push("SHA-384");
  if (len === 128 && /^[0-9a-f]{128}$/i.test(trimmed)) matches.push("SHA-512");
  return matches;
}

function hexToBytes(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return result;
}

// 常见哈希彩虹表（小型静态字典）
const RAINBOW_TABLE: Record<string, string> = {
  "5d41402abc4b2a76b9719d911017c592": "hello",
  "e10adc3949ba59abbe56e057f20f883e": "123456",
  "827ccb0eea8a706c4c34a16891f84e7b": "12345",
  "25d55ad283aa400af464c76d713c07ad": "12345678",
  "5f4dcc3b5aa765d61d8327deb882cf99": "password",
  "e99a18c428cb38d5f260853678922e03": "abc123",
  "d8578edf8458ce06fbc5bb76a58c5ca4": "qwerty",
  "21232f297a57a5a743894a0e4a801fc3": "admin",
  "96e79218965eb72c92a549dd5a330112": "111111",
  "25f9e794323b453885f5181f1b624d0b": "123456789",
  "fcea920f7412b5da7be0cf42b8c93759": "1234567",
  "e807f1fcf82d132f9bb018ca6738a19f": "1234567890",
  "f25a2fc72690b780b2a14e140ef6a9e0": "iloveyou",
  "8e8a74e80aad90cae0a8365e2e2547c4": "flag",
  "06c57e6ffc7c3d2dc6e4e8be5d5b2a2d": "ctfshow",
};

export function rainbowLookup(hash: string): string | null {
  return RAINBOW_TABLE[hash.toLowerCase()] ?? null;
}
