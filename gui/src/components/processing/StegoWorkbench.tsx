import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { DEFAULT_STEGO_OPTIONS } from "../../lib/stegoAnalyzer";
import { MAX_STEGO_FILE_BYTES, validateImageDimensions } from "../../lib/localFileLimits";
import { OperationGeneration } from "../../lib/operationGeneration";
import { decodeSpecialImagePixels } from "../../lib/stegoImageDecoder";
import { detectImageFormat, encodePngPixels, naturalSortImageParts, stitchImagePartsVertically, type MagicImageFormat } from "../../lib/stegoMagic";
import { collectStegoOcrCandidates, normalizeStegoOcrSource, recognizeStegoCandidates } from "../../lib/stegoOcr";
import { OfflineStegoOcrEngine } from "../../lib/stegoOcrEngine";
import type { StegoLocalAnalysis, StegoPixelSource } from "../../lib/stegoTypes";
import { StegoWorkerClient } from "../../lib/stegoWorkerClient";
import { StegoParameterPanel } from "./stego/StegoParameterPanel";
import { StegoResultsPanel } from "./stego/StegoResultsPanel";
import { StegoSourcePanel } from "./stego/StegoSourcePanel";

interface StegoWorkbenchProps {
  analysis?: StegoLocalAnalysis;
  flagPrefixes: readonly string[];
  flagCaseSensitive: boolean;
  flagEnabled: boolean;
  onAnalysisChange: (analysis: StegoLocalAnalysis) => void;
  onClear: () => void;
}

function initialAnalysis(): StegoLocalAnalysis {
  return { kind: "stego", status: "idle", options: { ...DEFAULT_STEGO_OPTIONS }, selectedTab: "overview" };
}

function readDataUrl(bytes: Uint8Array, mediaType: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取图片预览失败")));
    reader.readAsDataURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType }));
  });
}

function decodePixels(dataUrl: string): Promise<StegoPixelSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      try {
        validateImageDimensions(image.naturalWidth, image.naturalHeight);
      } catch (error) {
        reject(error);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return reject(new Error("当前环境无法读取图片像素"));
      context.drawImage(image, 0, 0);
      resolve({ width: canvas.width, height: canvas.height, rgba: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) });
    });
    image.addEventListener("error", () => reject(new Error("图片格式无法解码")));
    image.src = dataUrl;
  });
}

async function decodeMagicImage(bytes: Uint8Array, mediaType: string, format?: MagicImageFormat) {
  if (format) {
    const pixels = await decodeSpecialImagePixels(bytes, format);
    if (pixels) {
      return { pixels, dataUrl: await readDataUrl(encodePngPixels(pixels), "image/png") };
    }
  }
  const dataUrl = await readDataUrl(bytes, mediaType);
  return { dataUrl, pixels: await decodePixels(dataUrl) };
}

export function StegoWorkbench({ analysis: provided, flagPrefixes, flagCaseSensitive, flagEnabled, onAnalysisChange, onClear }: StegoWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<StegoWorkerClient>();
  const generationRef = useRef(new OperationGeneration());
  const ocrControllerRef = useRef<AbortController>();
  const ocrEngineRef = useRef<OfflineStegoOcrEngine>();
  analysisRef.current = analysis;
  useEffect(() => () => {
    generationRef.current.invalidate();
    clientRef.current?.dispose();
    ocrControllerRef.current?.abort();
    void ocrEngineRef.current?.dispose();
  }, []);
  const client = () => clientRef.current ??= new StegoWorkerClient();
  const update = (patch: Partial<StegoLocalAnalysis>) => {
    const next = { ...analysisRef.current, ...patch };
    analysisRef.current = next;
    onAnalysisChange(next);
  };

  const loadFile = async (file: File) => {
    const generation = generationRef.current.begin();
    clientRef.current?.cancel();
    ocrControllerRef.current?.abort();
    void ocrEngineRef.current?.dispose();
    if (file.size > MAX_STEGO_FILE_BYTES) {
      update({ status: "failed", fileName: file.name, fileSize: file.size, bytes: undefined, pixels: undefined, dataUrl: undefined, batchParts: undefined, report: undefined, error: "文件超过 128 MiB 限制" });
      return false;
    }
    update({ status: "loading", fileName: file.name, fileSize: file.size, fileType: file.type || "application/octet-stream", bytes: undefined, pixels: undefined, dataUrl: undefined, batchParts: undefined, report: undefined, error: undefined });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!generationRef.current.isCurrent(generation)) return false;
      const detected = detectImageFormat(bytes);
      let dataUrl: string | undefined;
      let pixels: StegoPixelSource | undefined;
      if (detected || file.type.startsWith("image/")) {
        try {
          const decoded = await decodeMagicImage(bytes, detected?.mediaType ?? file.type, detected?.format);
          dataUrl = decoded.dataUrl;
          pixels = decoded.pixels;
        } catch {
          dataUrl = undefined;
        }
      }
      if (!generationRef.current.isCurrent(generation)) return false;
      update({ status: "idle", fileType: detected?.mediaType ?? (file.type || "application/octet-stream"), bytes, pixels, dataUrl, batchParts: undefined, report: undefined, selectedTab: "overview", error: undefined });
      return true;
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return false;
      update({ status: "failed", bytes: undefined, pixels: undefined, report: undefined, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const loadFiles = async (files: File[]) => {
    if (files.length === 1) return loadFile(files[0]);
    const generation = generationRef.current.begin();
    clientRef.current?.cancel();
    ocrControllerRef.current?.abort();
    void ocrEngineRef.current?.dispose();
    if (files.length > 64) {
      update({ status: "failed", report: undefined, error: "批量拼接最多支持 64 张图片" });
      return;
    }
    const totalSize = files.reduce((total, file) => total + file.size, 0);
    if (totalSize > MAX_STEGO_FILE_BYTES) {
      update({ status: "failed", report: undefined, error: "批量文件总大小超过 128 MiB 限制" });
      return;
    }
    update({ status: "loading", fileName: `${files.length} 个待拼接文件`, fileSize: totalSize, fileType: "image/*", bytes: undefined, pixels: undefined, dataUrl: undefined, batchParts: undefined, report: undefined, error: undefined });
    try {
      const encodedParts = await Promise.all(files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const detected = detectImageFormat(bytes);
        if (!detected) throw new Error(`${file.name} 不是当前可解码的图片格式`);
        return { name: file.name, bytes, detected };
      }));
      const sorted = naturalSortImageParts(encodedParts);
      const decodedParts: Array<{ name: string; format: string; width: number; height: number; rgba: Uint8Array }> = [];
      for (const part of sorted) {
        if (!generationRef.current.isCurrent(generation)) return;
        const decoded = await decodeMagicImage(part.bytes, part.detected.mediaType, part.detected.format);
        decodedParts.push({ name: part.name, ...decoded.pixels, format: part.detected.format });
      }
      const pixels = stitchImagePartsVertically(decodedParts);
      const bytes = encodePngPixels(pixels);
      const dataUrl = await readDataUrl(bytes, "image/png");
      if (!generationRef.current.isCurrent(generation)) return;
      update({
        status: "idle",
        fileName: `批量拼接-${files.length}.png`,
        fileSize: totalSize,
        fileType: "image/png",
        bytes,
        pixels,
        dataUrl,
        batchParts: decodedParts.map((part) => ({ name: part.name, format: part.format, width: part.width, height: part.height })),
        report: undefined,
        selectedTab: "overview",
        error: undefined,
      });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "failed", bytes: undefined, pixels: undefined, dataUrl: undefined, batchParts: undefined, report: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const run = async () => {
    const current = analysisRef.current;
    if (!current.bytes) return;
    if (current.status === "running") {
      generationRef.current.invalidate();
      client().cancel();
      update({ status: "cancelled", progress: undefined });
      ocrControllerRef.current?.abort();
      void ocrEngineRef.current?.dispose();
      return;
    }
    const generation = generationRef.current.begin();
    update({ status: "running", report: undefined, progress: undefined, error: undefined });
    try {
      const report = await client().analyze({ fileName: current.fileName ?? "sample.bin", mediaType: current.fileType, bytes: current.bytes, pixels: current.pixels, prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive }, current.options, (progress) => {
        if (generationRef.current.isCurrent(generation)) update({ progress });
      });
      if (!generationRef.current.isCurrent(generation)) return;
      if (current.options.ocr) {
        const sourceFormat = detectImageFormat(current.bytes);
        const candidates = collectStegoOcrCandidates(report, { source: sourceFormat ? normalizeStegoOcrSource({ id: "source:input", label: current.batchParts ? `批量拼接图（${current.batchParts.length} 片）` : "原始图片", mediaType: sourceFormat.mediaType, bytes: current.bytes }, current.pixels) : undefined });
        report.ocr = [];
        if (candidates.length > 0) {
          const controller = new AbortController();
          const engine = new OfflineStegoOcrEngine();
          ocrControllerRef.current = controller;
          ocrEngineRef.current = engine;
          let completed = 0;
          update({ progress: { stage: "ocr", completed, total: candidates.length } });
          try {
            const ocr = await recognizeStegoCandidates(candidates, flagEnabled ? flagPrefixes : [], flagCaseSensitive, async (candidate, signal) => {
              const result = await engine.recognize(candidate, signal);
              completed += 1;
              if (generationRef.current.isCurrent(generation)) update({ progress: { stage: "ocr", completed, total: candidates.length } });
              return result;
            }, controller.signal);
            if (!generationRef.current.isCurrent(generation)) return;
            report.ocr = ocr.results;
            report.findings.push(...ocr.findings);
            const severity = { high: 0, suspicious: 1, info: 2 };
            report.findings.sort((left, right) => severity[left.severity] - severity[right.severity] || left.title.localeCompare(right.title));
          } finally {
            if (ocrControllerRef.current === controller) ocrControllerRef.current = undefined;
            if (ocrEngineRef.current === engine) ocrEngineRef.current = undefined;
            await engine.dispose();
          }
        }
      }
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "completed", report, progress: undefined, selectedTab: "overview" });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      if (error instanceof Error && error.name === "AbortError") update({ status: "cancelled", progress: undefined });
      else update({ status: "failed", progress: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const exportBytes = (bytes: Uint8Array, fileName: string, mediaType: string) => {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.replace(/[<>:"/\\|?*]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const analyzeCandidate = async (bytes: Uint8Array, fileName: string, mediaType: string) => {
    const file = new File([bytes.slice().buffer as ArrayBuffer], fileName, { type: mediaType });
    if (await loadFile(file)) await run();
  };

  return <section className="local-workbench misc-workbench stego-workbench">
    <div className="local-tool-strip"><div><span>Misc / 图片 / 文件隐写</span><strong>结构、元数据、编码、DCT 与频域联合分析</strong></div><div className="local-tool-actions"><button type="button" className="secondary-action" onClick={() => { generationRef.current.invalidate(); clientRef.current?.cancel(); ocrControllerRef.current?.abort(); void ocrEngineRef.current?.dispose(); onClear(); }}><RotateCcw size={14} />清空</button><button type="button" className="run-action" disabled={!analysis.bytes || analysis.status === "loading"} onClick={() => void run()}>{analysis.status === "running" ? <Square size={13} /> : <Play size={14} />}{analysis.status === "running" ? "取消" : "开始分析"}</button></div></div>
    <div className="misc-workspace-grid stego-workspace-grid">
      <section className="asset-stage"><header className="local-section-header"><div><strong>输入文件与原图</strong><span>{analysis.fileName ?? "尚未载入文件"}</span></div></header><StegoSourcePanel analysis={analysis} disabled={analysis.status === "loading" || analysis.status === "running"} onFiles={(files) => void loadFiles(files)} /></section>
      <section className="analysis-inspector"><header className="local-section-header"><div><strong>分析参数</strong><span>所有模块均为 CTFBox 内置实现</span></div></header><StegoParameterPanel analysis={analysis} disabled={analysis.status === "loading" || analysis.status === "running"} onChange={onAnalysisChange} /></section>
      <section className="extraction-results"><header className="local-section-header"><div><strong>分析结果</strong><span>{analysis.progress ? `${analysis.progress.stage} · ${analysis.progress.completed}/${analysis.progress.total}` : analysis.report ? `${analysis.report.findings.length} 条证据` : "运行后显示结构化证据"}</span></div></header><StegoResultsPanel analysis={analysis} onTab={(selectedTab) => update({ selectedTab })} onExport={exportBytes} onAnalyze={analyzeCandidate} /></section>
    </div>
  </section>;
}
