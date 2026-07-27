import { analyzeJpegDct } from "./jpegDct";
import { detectF5, extractJsteg } from "./jpegStegExtract";
import { analyzePalette } from "./paletteStego";
import { analyzeAnimationFrames } from "./stegoAnimation";
import { analyzeStegoChannels } from "./stegoChannels";
import { analyzeImageDimensions } from "./stegoDimensions";
import { scanEmbeddedContent } from "./stegoCarving";
import { analyzeFrequency, buildPixelVisuals } from "./stegoFrequency";
import { extractStegoMetadata } from "./stegoMetadata";
import { reinterpretPngAsBmp } from "./stegoPixelCarving";
import { analyzePngChunkRepairs } from "./stegoPngEditor";
import { extractStegoStrings } from "./stegoStrings";
import { analyzeStructure } from "./stegoStructure";
import type {
  StegoFinding,
  StegoOptions,
  StegoPixelSource,
  StegoProgress,
  StegoReport,
} from "./stegoTypes";

export const DEFAULT_STEGO_OPTIONS: StegoOptions = {
  metadata: true,
  structure: true,
  channels: true,
  dimensions: true,
  recursiveCarving: true,
  trailing: true,
  strings: true,
  visuals: true,
  dct: true,
  frequency: true,
  ocr: true,
  minimumStringLength: 4,
  fftSize: 256,
};

export interface StegoAnalysisInput {
  fileName: string;
  mediaType?: string;
  bytes: Uint8Array;
  pixels?: StegoPixelSource;
  prefixes?: readonly string[];
  caseSensitive?: boolean;
}

export interface StegoAnalysisHooks {
  signal: AbortSignal;
  onProgress?: (progress: StegoProgress) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function compareFindings(left: StegoFinding, right: StegoFinding) {
  const rank = { high: 0, suspicious: 1, info: 2 };
  return rank[left.severity] - rank[right.severity]
    || (left.offset ?? Number.MAX_SAFE_INTEGER) - (right.offset ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title);
}

export async function analyzeStego(input: StegoAnalysisInput, options: StegoOptions, hooks: StegoAnalysisHooks): Promise<StegoReport> {
  const stages: StegoProgress["stage"][] = [];
  if (options.structure || options.trailing) stages.push("structure");
  if (options.channels) stages.push("channels");
  if (options.dimensions) stages.push("dimensions");
  if (options.recursiveCarving) stages.push("carving");
  if (options.metadata) stages.push("metadata");
  if (options.strings) stages.push("strings");
  if (options.visuals) stages.push("visuals");
  if (options.dct) stages.push("dct");
  if (options.frequency) stages.push("frequency");

  const findings: StegoFinding[] = [];
  const report: StegoReport = { format: "未知", findings, sections: [], metadata: [], strings: [], visuals: [], carvedFiles: [], channels: [], repairs: [] };
  let completed = 0;
  const beforeStage = async (stage: StegoProgress["stage"]) => {
    if (hooks.signal.aborted) throw abortError();
    hooks.onProgress?.({ stage, completed, total: stages.length });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (hooks.signal.aborted) throw abortError();
  };
  const finishStage = () => {
    completed += 1;
  };
  const failure = (stage: string, error: unknown): StegoFinding => ({
    id: `stage-error-${stage}`,
    severity: "suspicious",
    source: stage,
    title: `${stage}分析未完成`,
    detail: error instanceof Error ? error.message : String(error),
  });

  let detectedFormat = "未知";
  if (stages.includes("structure")) {
    await beforeStage("structure");
    try {
      const structure = analyzeStructure(input.bytes);
      detectedFormat = structure.format;
      report.format = structure.format;
      report.logicalEnd = structure.logicalEnd;
      if (options.structure) {
        report.sections = options.trailing ? structure.sections : structure.sections.filter((section) => section.type !== "trailing");
        findings.push(...structure.findings.filter((item) => options.trailing || item.title !== "发现文件尾附加数据"));
      } else if (options.trailing) findings.push(...structure.findings.filter((item) => item.title === "发现文件尾附加数据"));
      if (options.trailing) report.carvedFiles = structure.carvedFiles;
    } catch (error) {
      findings.push(failure("结构", error));
    }
    finishStage();
  } else {
    detectedFormat = analyzeStructure(input.bytes).format;
    report.format = detectedFormat;
  }

  if (options.channels) {
    await beforeStage("channels");
    try {
      const channels = analyzeStegoChannels(input.bytes, input.prefixes ?? [], input.caseSensitive ?? false);
      report.channels = channels.candidates;
      report.visuals.push(...channels.visuals);
      findings.push(...channels.findings);
    } catch (error) {
      findings.push(failure("结构信道", error));
    }
    finishStage();
  }

  if (options.dimensions) {
    await beforeStage("dimensions");
    try {
      const dimensions = analyzeImageDimensions(input.bytes);
      const pngChunks = analyzePngChunkRepairs(input.bytes);
      report.repairs = [...dimensions.repairs, ...pngChunks.repairs];
      findings.push(...dimensions.findings);
      findings.push(...pngChunks.findings);
    } catch (error) {
      findings.push(failure("尺寸恢复", error));
    }
    finishStage();
  }

  if (options.recursiveCarving) {
    await beforeStage("carving");
    try {
      const carving = await scanEmbeddedContent(input.bytes, {
        prefixes: input.prefixes ?? [],
        caseSensitive: input.caseSensitive ?? false,
      });
      const merged = new Map(report.carvedFiles.map((file) => [`${file.offset}:${file.mediaType}:${file.bytes.length}`, file]));
      for (const file of carving.files) {
        const key = `${file.offset}:${file.mediaType}:${file.bytes.length}`;
        const previous = merged.get(key);
        if (!previous || (file.children?.length ?? 0) > (previous.children?.length ?? 0)) merged.set(key, file);
      }
      report.carvedFiles = [...merged.values()].sort((left, right) => left.offset - right.offset || right.bytes.length - left.bytes.length);
      findings.push(...carving.findings);
      if (detectedFormat === "PNG") {
        const converted = reinterpretPngAsBmp(input.bytes);
        if (converted.supported) {
          const pixelCarving = await scanEmbeddedContent(converted.bytes, {
            prefixes: input.prefixes ?? [],
            caseSensitive: input.caseSensitive ?? false,
          });
          if (pixelCarving.files.length > 0) {
            report.repairs ??= [];
            report.repairs.push({
              id: "png-pixels-as-bmp",
              format: "BMP",
              label: "PNG 像素无损重解释为 24 位 BMP",
              width: converted.width,
              height: converted.height,
              confidence: "exact",
              detail: `按原始 PNG 滤波字节恢复 RGB，并以 BGR 倒序扫描线写出；发现 ${pixelCarving.files.length} 个嵌入候选`,
              bytes: converted.bytes,
            });
            report.carvedFiles.push({
              name: "png-pixels-as-bmp.bmp",
              mediaType: "image/bmp",
              offset: 0,
              bytes: converted.bytes,
              children: pixelCarving.files,
            });
            findings.push(...pixelCarving.findings.map((finding) => ({
              ...finding,
              id: `pixel-${finding.id}`,
              source: `像素重解释 · ${finding.source}`,
            })));
          }
        }
      }
      // Ensure carved files produce findings even when flag isn't in plain text
      if (report.carvedFiles.length > 0) {
        const visibleCarved = report.carvedFiles.filter((f) => f.bytes.length >= 64 || (f.children?.length ?? 0) > 0);
        if (visibleCarved.length > 0 && !findings.some((f) => f.id?.includes("carved"))) {
          findings.push({
            id: `carved-count-${findings.length}`,
            severity: "suspicious",
            source: "递归雕刻",
            title: `雕刻出 ${visibleCarved.length} 个嵌入文件`,
            detail: visibleCarved.slice(0, 5).map((f) => `${f.name} (${f.bytes.length}B)`).join(" · "),
          });
        }
      }
    } catch (error) {
      findings.push(failure("递归雕刻", error));
    }
    finishStage();
  }

  if (options.metadata) {
    await beforeStage("metadata");
    try {
      const metadata = extractStegoMetadata(input.bytes, {
        prefixes: input.prefixes ?? [],
        caseSensitive: input.caseSensitive ?? false,
      });
      report.metadata = metadata.entries;
      findings.push(...metadata.findings);
    } catch (error) {
      findings.push(failure("元数据", error));
    }
    finishStage();
  }

  if (options.strings) {
    await beforeStage("strings");
    try {
      const strings = extractStegoStrings(input.bytes, {
        minimumLength: options.minimumStringLength,
        prefixes: input.prefixes ?? [],
        caseSensitive: input.caseSensitive ?? false,
      });
      report.strings = strings.hits;
      findings.push(...strings.findings);
    } catch (error) {
      findings.push(failure("字符串", error));
    }
    finishStage();
  }

  if (options.visuals) {
    await beforeStage("visuals");
    try {
      const animation = analyzeAnimationFrames(input.bytes);
      report.visuals.push(...animation.visuals);
      report.carvedFiles.push(...animation.files);
      findings.push(...animation.findings);
      if (input.pixels) report.visuals.push(...buildPixelVisuals(input.pixels));
      else findings.push({ id: "visuals-no-pixels", severity: "info", source: "像素", title: "没有可解码像素", detail: "仍已执行字节级分析" });
    } catch (error) {
      findings.push(failure("像素", error));
    }
    finishStage();
  }

  if (options.dct) {
    await beforeStage("dct");
    try {
      if (detectedFormat === "JPEG") {
        report.dct = analyzeJpegDct(input.bytes);
        if (!report.dct.supported) findings.push({ id: "dct-unsupported", severity: "info", source: "JPEG DCT", title: "DCT 系数分析未执行", detail: report.dct.reason ?? "不支持的 JPEG 编码" });
        else {
          for (const warning of report.dct.warnings) findings.push({ id: `dct-warning-${findings.length}`, severity: "suspicious", source: "JPEG DCT", title: "DCT 数据不完整", detail: warning });
          const suspiciousPositions = (report.dct.oddRatios ?? []).map((ratio, index) => ({ ratio, index })).filter(({ ratio, index }) => index > 0 && (report.dct?.coefficientCounts?.[index] ?? 0) >= 32 && (ratio < 0.35 || ratio > 0.65));
          if (suspiciousPositions.length >= 4) findings.push({ id: "dct-parity", severity: "suspicious", source: "JPEG DCT", title: "多个 AC 位置奇偶分布偏斜", detail: suspiciousPositions.slice(0, 12).map(({ index, ratio }) => `${index}:${(ratio * 100).toFixed(1)}%`).join(" · ") });

          // JSteg extraction
          const jsteg = extractJsteg(input.bytes);
          if (jsteg.byteCount > 0) findings.push({ id: "jsteg-payload", severity: "high", source: "JPEG JSteg", title: "JSteg 提取到载荷", detail: `${jsteg.byteCount} 字节` });
          else findings.push({ id: "jsteg-check", severity: "info", source: "JPEG JSteg", title: "JSteg 分析", detail: jsteg.detail });

          // F5 detection
          const f5 = detectF5(input.bytes);
          if (f5.detected) findings.push({ id: "f5-detect", severity: "suspicious", source: "JPEG F5", title: "F5 算法特征检出", detail: f5.detail });
        }
      }
    } catch (error) {
      findings.push(failure("JPEG DCT", error));
    }
    finishStage();
  }

  if (options.frequency) {
    await beforeStage("frequency");
    try {
      if (input.pixels) {
        const frequency = analyzeFrequency(input.pixels, options.fftSize);
        report.visuals.push(frequency.visual);
        if (frequency.peaks.length > 0) findings.push({ id: "frequency-peaks", severity: "info", source: "FFT", title: "频谱存在非 DC 峰值", detail: frequency.peaks.slice(0, 6).map((peak) => `(${peak.x},${peak.y})`).join(" · ") });
      }
    } catch (error) {
      findings.push(failure("频域", error));
    }
    finishStage();
  }

  report.findings.sort(compareFindings);
  return report;
}
