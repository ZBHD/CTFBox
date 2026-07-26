// 视频隐写分析：格式识别 + 帧间差分框架
export interface VideoResult {
  findings: VideoFinding[];
}

export interface VideoFinding {
  id: string;
  severity: "high" | "suspicious" | "info";
  source: string;
  title: string;
  detail: string;
}

// Video format identification from magic bytes
export function identifyVideoFormat(bytes: Uint8Array): string {
  if (bytes.length < 8) return "未知";
  const head = String.fromCharCode(...bytes.subarray(0, 8));

  if (head.startsWith("\x1a\x45\xdf\xa3")) return "MKV/WebM (Matroska)";
  if (head.startsWith("\x00\x00\x00")) {
    const boxType = head.substring(4, 8);
    if (boxType === "ftyp") return "MP4/MOV (ISO BMFF)";
    if (boxType === "moov") return "MP4/MOV";
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) return "MPEG 视频";
  if (bytes[0] === 0x47 && bytes[1] === 0x40) return "MPEG-TS";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "AVI (RIFF)";
  if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xB2 && bytes[3] === 0x75) return "ASF/WMV";

  return "未知视频格式";
}

export function analyzeVideo(bytes: Uint8Array): VideoResult {
  const findings: VideoFinding[] = [];
  const format = identifyVideoFormat(bytes);
  findings.push({ id: "video-format", severity: "info", source: "视频", title: `视频格式：${format}`, detail: `${bytes.length} 字节` });

  // Trailing data detection (common stego vector)
  if (format === "AVI (RIFF)" && bytes.length > 1024) {
    const riffSize = (bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24) >>> 0;
    if (riffSize + 8 < bytes.length) {
      findings.push({ id: "video-trailing", severity: "suspicious", source: "视频", title: "文件尾存在附加数据", detail: `RIFF 声明 ${riffSize + 8} 字节，实际 ${bytes.length} 字节` });
    }
  }

  // MKV segment size check
  if ((format === "MKV/WebM (Matroska)" || format === "MP4/MOV (ISO BMFF)") && bytes.length > 1024 * 1024) {
    findings.push({ id: "video-large", severity: "info", source: "视频", title: "大文件", detail: "视频可能存在帧内/帧间隐写，帧提取需浏览器解码支持" });
  }

  return { findings };
}
