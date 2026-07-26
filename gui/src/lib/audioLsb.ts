// 从整数 PCM 样本的低位重建字节流。约定：从 bit0 起向上取 bitPlanes 位，MSB-first 打包为字节。
// 这与常见 WAV LSB CTF 题（每样本取最低位、高位在前）一致。

const CHANNEL_MAP: Record<string, number> = { L: 0, R: 1, C: 2, S: 3 };

export function selectChannels(channels: Int32Array[], mask: string): number[] {
  const indices: number[] = [];
  for (const letter of mask.toUpperCase()) {
    const index = CHANNEL_MAP[letter];
    if (index !== undefined && index < channels.length && !indices.includes(index)) indices.push(index);
  }
  if (indices.length === 0) for (let i = 0; i < channels.length; i += 1) indices.push(i);
  return indices;
}

export function extractLsbBytes(
  channels: Int32Array[],
  mask: string,
  order: "interleaved" | "perChannel",
  bitPlanes: number,
  maxBytes = 1 << 20,
): Uint8Array {
  const selected = selectChannels(channels, mask);
  const planes = Math.max(1, Math.min(8, Math.floor(bitPlanes) || 1));
  const frames = channels[0]?.length ?? 0;
  const maxBits = maxBytes * 8;
  const bits: number[] = [];

  const pushSample = (value: number): boolean => {
    for (let bit = 0; bit < planes; bit += 1) {
      bits.push((value >> bit) & 1);
      if (bits.length >= maxBits) return true;
    }
    return false;
  };

  let full = false;
  if (order === "perChannel") {
    for (const channel of selected) {
      for (let frame = 0; frame < frames && !full; frame += 1) full = pushSample(channels[channel][frame]);
      if (full) break;
    }
  } else {
    for (let frame = 0; frame < frames && !full; frame += 1) {
      for (const channel of selected) {
        full = pushSample(channels[channel][frame]);
        if (full) break;
      }
    }
  }

  const byteLength = Math.floor(bits.length / 8);
  const output = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[i * 8 + bit];
    output[i] = value;
  }
  return output;
}

// 逐样本差分（首声道 − 次声道），用于立体声差分隐写。
export function channelDifference(channels: Int32Array[]): Int32Array {
  if (channels.length < 2) return new Int32Array(0);
  const frames = Math.min(channels[0].length, channels[1].length);
  const diff = new Int32Array(frames);
  for (let i = 0; i < frames; i += 1) diff[i] = channels[0][i] - channels[1][i];
  return diff;
}

export function longestPrintableRun(bytes: Uint8Array): number {
  let longest = 0;
  let current = 0;
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      current += 1;
      if (current > longest) longest = current;
    } else current = 0;
  }
  return longest;
}
