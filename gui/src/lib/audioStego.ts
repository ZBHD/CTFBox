// 音频隐写分析编排：以「已解码 PCM + 原始文件字节」为输入（解码在主线程完成），
// 依次跑波形/频谱/LSB/声道差分/字符串/元数据，产出结构化证据。纯逻辑，可单测。
import { channelDifference, extractLsbBytes, longestPrintableRun } from "./audioLsb";
import { renderSpectrogram, renderWaveform } from "./audioRender";
import type {
  AudioFinding,
  AudioOptions,
  AudioPcm,
  AudioProgress,
  AudioReport,
  AudioTrackInfo,
} from "./audioTypes";
import { detectFlags } from "./flagDetector";
import { decodeTextPreview, findEmbeddedFiles } from "./lsbFormats";
import { extractStegoStrings } from "./stegoStrings";
import type { StegoStringHit } from "./stegoTypes";
import { parseWavChunks } from "./wavDecoder";

export interface AudioAnalysisInput {
  fileName: string;
  bytes: Uint8Array;
  pcm: AudioPcm;
  options: AudioOptions;
  prefixes?: readonly string[];
  caseSensitive?: boolean;
}

export interface AudioAnalysisHooks {
  signal: AbortSignal;
  onProgress?: (progress: AudioProgress) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function detectFormat(fileName: string, bytes: Uint8Array) {
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "WAV";
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toUpperCase() : "未知";
}

function flagsFor(bytes: Uint8Array, prefixes: readonly string[], caseSensitive: boolean) {
  const { text } = decodeTextPreview(bytes);
  return [...new Set(detectFlags(text, prefixes, caseSensitive).map((hit) => hit.text))];
}

function compareFindings(left: AudioFinding, right: AudioFinding) {
  const rank = { high: 0, suspicious: 1, info: 2 };
  return rank[left.severity] - rank[right.severity] || left.title.localeCompare(right.title);
}

export async function analyzeAudio(input: AudioAnalysisInput, hooks: AudioAnalysisHooks): Promise<AudioReport> {
  const { pcm, options } = input;
  const prefixes = input.prefixes ?? [];
  const caseSensitive = input.caseSensitive ?? false;
  const frames = pcm.channels[0]?.length ?? 0;

  const track: AudioTrackInfo = {
    format: detectFormat(input.fileName, input.bytes),
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.length,
    bitDepth: pcm.bitDepth,
    durationSeconds: pcm.sampleRate > 0 ? frames / pcm.sampleRate : 0,
    lossy: pcm.lossy,
  };
  const report: AudioReport = { track, findings: [], visuals: [], strings: [], metadata: [], carvedFiles: [] };

  const stages: AudioProgress["stage"][] = [];
  if (options.waveform) stages.push("waveform");
  if (options.spectrogram) stages.push("spectrogram");
  if (options.lsb && !pcm.lossy) stages.push("lsb");
  if (options.channelDiff && pcm.channels.length >= 2 && !pcm.lossy) stages.push("channelDiff");
  if (options.strings) stages.push("strings");
  if (options.metadata) stages.push("metadata");

  let completed = 0;
  const beforeStage = async (stage: AudioProgress["stage"]) => {
    if (hooks.signal.aborted) throw abortError();
    hooks.onProgress?.({ stage, completed, total: stages.length });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (hooks.signal.aborted) throw abortError();
  };
  const failure = (source: string, error: unknown): AudioFinding => ({
    id: `stage-error-${source}`,
    severity: "suspicious",
    source,
    title: `${source}分析未完成`,
    detail: error instanceof Error ? error.message : String(error),
  });

  if (options.lsb && pcm.lossy) {
    report.findings.push({ id: "lsb-lossy", severity: "info", source: "LSB", title: "有损格式无样本级 LSB", detail: "该格式经有损压缩，最低位不携带原始隐写数据，已跳过 LSB 提取。" });
  }

  if (options.waveform) {
    await beforeStage("waveform");
    try {
      pcm.channels.slice(0, 2).forEach((channel, index) => {
        report.visuals.push({
          id: `waveform-${index}`,
          label: `波形 · ${pcm.channels.length > 1 ? (index === 0 ? "左声道" : "右声道") : "单声道"}`,
          kind: "waveform",
          width: 800,
          height: 160,
          pixels: renderWaveform(channel, pcm.bitDepth),
        });
      });
    } catch (error) {
      report.findings.push(failure("波形", error));
    }
    completed += 1;
  }

  if (options.spectrogram) {
    await beforeStage("spectrogram");
    try {
      const spectrogram = renderSpectrogram(pcm.channels[0] ?? new Int32Array(0), pcm.sampleRate, pcm.bitDepth, options.fftSize);
      report.visuals.push({
        id: "spectrogram",
        label: "频谱图 · 首声道",
        kind: "spectrogram",
        width: spectrogram.width,
        height: spectrogram.height,
        pixels: spectrogram.pixels,
        detail: spectrogram.dominantHz ? `主频约 ${Math.round(spectrogram.dominantHz)} Hz` : undefined,
      });
      if (spectrogram.dominantHz && spectrogram.dominantShare > 0.6) {
        report.findings.push({ id: "spectrogram-tone", severity: "suspicious", source: "频谱", title: "存在持续强单音", detail: `约 ${Math.round(spectrogram.dominantHz)} Hz 在 ${(spectrogram.dominantShare * 100).toFixed(0)}% 的时间片占主导，可能是 FSK/隐藏载波。` });
      }
    } catch (error) {
      report.findings.push(failure("频谱", error));
    }
    completed += 1;
  }

  if (options.lsb && !pcm.lossy) {
    await beforeStage("lsb");
    try {
      const bytes = extractLsbBytes(pcm.channels, options.channelMask, options.order, options.bitPlanes);
      const flags = flagsFor(bytes, prefixes, caseSensitive);
      const strings = extractStegoStrings(bytes, { minimumLength: options.minimumStringLength, prefixes, caseSensitive });
      report.strings.push(...strings.hits);
      report.carvedFiles.push(...findEmbeddedFiles(bytes));
      if (flags.length > 0) {
        report.findings.push({ id: "lsb-flag", severity: "high", source: "LSB", title: "低位数据包含 Flag", detail: flags.join(" · ") });
      } else if (longestPrintableRun(bytes) >= 8) {
        report.findings.push({ id: "lsb-text", severity: "suspicious", source: "LSB", title: "低位数据疑似文本", detail: `重建 ${bytes.length} 字节，最长可打印片段 ${longestPrintableRun(bytes)} 字符。` });
      }
    } catch (error) {
      report.findings.push(failure("LSB", error));
    }
    completed += 1;
  }

  if (options.channelDiff && pcm.channels.length >= 2 && !pcm.lossy) {
    await beforeStage("channelDiff");
    try {
      const diff = channelDifference(pcm.channels);
      report.visuals.push({ id: "waveform-diff", label: "波形 · 声道差分 (L−R)", kind: "waveform", width: 800, height: 160, pixels: renderWaveform(diff, pcm.bitDepth) });
      const bytes = extractLsbBytes([diff], "L", options.order, options.bitPlanes);
      const flags = flagsFor(bytes, prefixes, caseSensitive);
      const strings = extractStegoStrings(bytes, { minimumLength: options.minimumStringLength, prefixes, caseSensitive });
      report.strings.push(...strings.hits);
      report.carvedFiles.push(...findEmbeddedFiles(bytes));
      if (flags.length > 0) {
        report.findings.push({ id: "diff-flag", severity: "high", source: "声道差分", title: "声道差分低位包含 Flag", detail: flags.join(" · ") });
      } else if (longestPrintableRun(bytes) >= 8) {
        report.findings.push({ id: "diff-text", severity: "suspicious", source: "声道差分", title: "声道差分低位疑似文本", detail: `差分低位重建 ${bytes.length} 字节，最长可打印片段 ${longestPrintableRun(bytes)} 字符。` });
      }
    } catch (error) {
      report.findings.push(failure("声道差分", error));
    }
    completed += 1;
  }

  if (options.strings) {
    await beforeStage("strings");
    try {
      const strings = extractStegoStrings(input.bytes, { minimumLength: options.minimumStringLength, prefixes, caseSensitive });
      report.strings = dedupeStrings([...strings.hits, ...report.strings]);
      report.findings.push(...strings.findings.map((finding): AudioFinding => ({ id: finding.id, severity: finding.severity, source: finding.source, title: finding.title, detail: finding.detail, offset: finding.offset })));
    } catch (error) {
      report.findings.push(failure("字符串", error));
    }
    completed += 1;
  }

  if (options.metadata) {
    await beforeStage("metadata");
    try {
      if (track.format === "WAV") {
        const container = parseWavChunks(input.bytes);
        report.metadata.push(...container.metadata);
        if (container.trailing.length > 0) {
          report.findings.push({ id: "wav-trailing", severity: "suspicious", source: "容器", title: "data 块后存在附加数据", detail: `末尾 ${container.trailing.length} 字节位于所有 RIFF 块之外。`, offset: container.trailingOffset });
          report.carvedFiles.push(...findEmbeddedFiles(container.trailing).map((file) => ({ ...file, offset: file.offset + container.trailingOffset })));
        }
      }
    } catch (error) {
      report.findings.push(failure("元数据", error));
    }
    completed += 1;
  }

  report.findings.sort(compareFindings);
  return report;
}

function dedupeStrings(hits: StegoStringHit[]): StegoStringHit[] {
  const seen = new Set<string>();
  const result: StegoStringHit[] = [];
  for (const hit of hits) {
    const key = `${hit.encoding}:${hit.offset}:${hit.text}:${hit.decodedFrom ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}
