// MP3 隐写检测：mp3stego / 帧头异常分析
export interface Mp3Result {
  detected: boolean;
  frames: number;
  privateBitFrames: number;
  detail: string;
}

// MPEG Audio frame header: 12-bit sync (0xFFF), then version/layer/bitrate/etc
const MPEG_SAMPLERATES: Record<number, Record<number, number>> = {
  // MPEG version [version][index] → sample rate
  0: { 0: 44100, 1: 48000, 2: 32000 }, // MPEG 2.5
  2: { 0: 22050, 1: 24000, 2: 16000 }, // MPEG 2
  3: { 0: 44100, 1: 48000, 2: 32000 }, // MPEG 1
};

const MPEG_BITRATES: Record<number, Record<number, Record<number, number>>> = {
  1: { // Layer III
    3: { 1: 32, 2: 40, 3: 48, 4: 56, 5: 64, 6: 80, 7: 96, 8: 112, 9: 128, 10: 160, 11: 192, 12: 224, 13: 256, 14: 320 },
    2: { 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 7: 56, 8: 64, 9: 80, 10: 96, 11: 112, 12: 128, 13: 144, 14: 160 },
  },
};

export function detectMp3Stego(bytes: Uint8Array): Mp3Result {
  const findings: string[] = [];
  let frames = 0;
  let privateBitFrames = 0;
  let pos = 0;

  while (pos + 4 <= bytes.length) {
    // Find MPEG sync word
    if (bytes[pos] !== 0xFF || (bytes[pos + 1] & 0xE0) !== 0xE0) {
      pos += 1;
      continue;
    }

    const header = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    const versionBits = (header >> 19) & 3;
    const layerBits = (header >> 17) & 3;
    const bitrateIndex = (header >> 12) & 0xF;
    const sampleRateIndex = (header >> 10) & 3;
    const padding = (header >> 9) & 1;
    const privateBit = (header >> 8) & 1;

    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      pos += 1;
      continue;
    }

    const version = versionBits === 3 ? 3 : versionBits === 2 ? 2 : 0;
    const layer = 4 - layerBits; // 3=Layer I, 2=Layer II, 1=Layer III
    const sampleRate = MPEG_SAMPLERATES[version]?.[sampleRateIndex];
    const bitrate = MPEG_BITRATES[layer]?.[version]?.[bitrateIndex];

    if (!sampleRate || !bitrate) { pos += 1; continue; }

    // mp3stego specific: private_bit is always set to encode data
    if (privateBit === 1) privateBitFrames += 1;

    // Calculate frame size
    let frameSize: number;
    if (layer === 1) {
      frameSize = Math.floor((12 * bitrate * 1000 / sampleRate + padding) * 4);
    } else {
      frameSize = Math.floor(144 * bitrate * 1000 / sampleRate) + padding;
    }

    frames += 1;
    pos += frameSize;

    if (frames > 100_000) break; // safety limit
  }

  const detected = frames > 0 && (privateBitFrames > frames * 0.8);

  if (frames === 0) {
    return { detected: false, frames: 0, privateBitFrames: 0, detail: "未检测到 MPEG 音频帧" };
  }

  if (detected) {
    findings.push(`private_bit 持续置位 (${privateBitFrames}/${frames})`);
    findings.push("疑似 mp3stego 或类似工具嵌入");
  }

  return {
    detected,
    frames,
    privateBitFrames,
    detail: findings.length > 0 ? findings.join("；") : `MP3 正常：${frames} 帧，private_bit 比率 ${(privateBitFrames / frames * 100).toFixed(1)}%`,
  };
}
