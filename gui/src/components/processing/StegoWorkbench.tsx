import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { DEFAULT_STEGO_OPTIONS } from "../../lib/stegoAnalyzer";
import { MAX_STEGO_FILE_BYTES, validateImageDimensions } from "../../lib/localFileLimits";
import { OperationGeneration } from "../../lib/operationGeneration";
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

function decodePixels(sourceUrl: string): Promise<StegoPixelSource> {
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
    image.src = sourceUrl;
  });
}

function looksLikeImage(file: File) {
  return file.type.startsWith("image/") || /\.(?:png|jpe?g|gif|bmp|webp|tiff?|ico)$/i.test(file.name);
}

export function StegoWorkbench({ analysis: provided, flagPrefixes, flagCaseSensitive, flagEnabled, onAnalysisChange, onClear }: StegoWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<StegoWorkerClient>();
  const generationRef = useRef(new OperationGeneration());
  const previewUrlRef = useRef<string>();
  analysisRef.current = analysis;
  const revokePreview = () => {
    if (!previewUrlRef.current) return;
    URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = undefined;
  };
  useEffect(() => () => {
    generationRef.current.invalidate();
    clientRef.current?.dispose();
    revokePreview();
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
    revokePreview();
    if (file.size > MAX_STEGO_FILE_BYTES) {
      update({ status: "failed", fileName: file.name, fileSize: file.size, bytes: undefined, pixels: undefined, dataUrl: undefined, report: undefined, error: "文件超过 128 MiB 限制" });
      return;
    }
    update({ status: "loading", fileName: file.name, fileSize: file.size, fileType: file.type || "application/octet-stream", bytes: undefined, pixels: undefined, dataUrl: undefined, report: undefined, error: undefined });
    let previewUrl: string | undefined;
    try {
      previewUrl = looksLikeImage(file) ? URL.createObjectURL(file) : undefined;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!generationRef.current.isCurrent(generation)) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        return;
      }
      let pixels: StegoPixelSource | undefined;
      if (previewUrl) {
        try {
          pixels = await decodePixels(previewUrl);
        } catch {
          URL.revokeObjectURL(previewUrl);
        }
      }
      if (!generationRef.current.isCurrent(generation)) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        return;
      }
      const dataUrl = pixels ? previewUrl : undefined;
      previewUrlRef.current = dataUrl;
      update({ status: "idle", bytes, pixels, dataUrl, report: undefined, selectedTab: "overview", error: undefined });
    } catch (error) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "failed", bytes: undefined, pixels: undefined, report: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const run = async () => {
    const current = analysisRef.current;
    if (!current.bytes) return;
    if (current.status === "running") {
      generationRef.current.invalidate();
      client().cancel();
      update({ status: "cancelled", progress: undefined });
      return;
    }
    const generation = generationRef.current.begin();
    update({ status: "running", report: undefined, progress: undefined, error: undefined });
    try {
      const report = await client().analyze({ fileName: current.fileName ?? "sample.bin", mediaType: current.fileType, bytes: current.bytes, pixels: current.pixels, prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive }, current.options, (progress) => {
        if (generationRef.current.isCurrent(generation)) update({ progress });
      });
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

  return <section className="local-workbench misc-workbench stego-workbench">
    <div className="local-tool-strip"><div><span>Misc / 图片 / 文件隐写</span><strong>结构、元数据、编码、DCT 与频域联合分析</strong></div><div className="local-tool-actions"><button type="button" className="secondary-action" onClick={() => { generationRef.current.invalidate(); clientRef.current?.cancel(); revokePreview(); onClear(); }}><RotateCcw size={14} />清空</button><button type="button" className="run-action" disabled={!analysis.bytes || analysis.status === "loading"} onClick={() => void run()}>{analysis.status === "running" ? <Square size={13} /> : <Play size={14} />}{analysis.status === "running" ? "取消" : "开始分析"}</button></div></div>
    <div className="misc-workspace-grid stego-workspace-grid">
      <section className="asset-stage"><header className="local-section-header"><div><strong>输入文件与原图</strong><span>{analysis.fileName ?? "尚未载入文件"}</span></div></header><StegoSourcePanel analysis={analysis} disabled={analysis.status === "loading" || analysis.status === "running"} onFile={(file) => void loadFile(file)} /></section>
      <section className="analysis-inspector"><header className="local-section-header"><div><strong>分析参数</strong><span>所有模块均为 CTFBox 内置实现</span></div></header><StegoParameterPanel analysis={analysis} disabled={analysis.status === "loading" || analysis.status === "running"} onChange={onAnalysisChange} /></section>
      <section className="extraction-results"><header className="local-section-header"><div><strong>分析结果</strong><span>{analysis.progress ? `${analysis.progress.stage} · ${analysis.progress.completed}/${analysis.progress.total}` : analysis.report ? `${analysis.report.findings.length} 条证据` : "运行后显示结构化证据"}</span></div></header><StegoResultsPanel analysis={analysis} onTab={(selectedTab) => update({ selectedTab })} onExport={exportBytes} /></section>
    </div>
  </section>;
}
