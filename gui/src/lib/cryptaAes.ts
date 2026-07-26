// AES 模式分析：ECB 检测 + 企鹅图生成
export interface AesEcbResult {
  ecbDetected: boolean;
  blockSize: number;
  totalBlocks: number;
  repeatedBlocks: number;
  repetitionRatio: number;
  detail: string;
}

export function detectEcb(data: Uint8Array, blockSize = 16): AesEcbResult {
  if (data.length < blockSize * 2) {
    return { ecbDetected: false, blockSize, totalBlocks: 0, repeatedBlocks: 0, repetitionRatio: 0, detail: "数据不足，至少需要 2 个块" };
  }
  const blocks: string[] = [];
  for (let i = 0; i + blockSize <= data.length; i += blockSize) {
    blocks.push(Array.from(data.subarray(i, i + blockSize), (b) => b.toString(16).padStart(2, "0")).join(""));
  }
  const unique = new Set(blocks);
  const repeated = blocks.length - unique.size;
  const ratio = repeated / blocks.length;
  return {
    ecbDetected: ratio > 0.05,
    blockSize,
    totalBlocks: blocks.length,
    repeatedBlocks: repeated,
    repetitionRatio: ratio,
    detail: ratio > 0.05 ? `发现 ${repeated} 个重复块 (${(ratio * 100).toFixed(1)}%)，强烈疑似 ECB 模式` : `${repeated} 个重复块，可能非 ECB`,
  };
}

// 企鹅图：将密文块作为 RGB 像素渲染
export function penguinVisual(data: Uint8Array, blockSize = 16): Uint8ClampedArray | null {
  // 将每个块的第一个 RGB 三元组作为像素
  const blockCount = Math.floor(data.length / blockSize);
  const side = Math.ceil(Math.sqrt(blockCount));
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const offset = i * 4;
    if (i < blockCount) {
      const blockStart = i * blockSize;
      pixels[offset] = data[blockStart] ?? 0;     // R
      pixels[offset + 1] = data[blockStart + 1] ?? 0; // G
      pixels[offset + 2] = data[blockStart + 2] ?? 0; // B
    } else {
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
    }
    pixels[offset + 3] = 255;
  }
  return pixels;
}

// AES CBC 比特翻转：给定密文位置，翻转前一块对应比特来翻转下一块明文
export function cbcBitFlip(ciphertext: Uint8Array, blockIndex: number, byteOffset: number, bitPosition: number): Uint8Array | null {
  const blockSize = 16;
  if (blockIndex < 1 || (blockIndex + 1) * blockSize > ciphertext.length) return null;
  const result = ciphertext.slice();
  const pos = (blockIndex - 1) * blockSize + byteOffset;
  if (pos >= ciphertext.length) return null;
  result[pos] ^= (1 << bitPosition);
  return result;
}
