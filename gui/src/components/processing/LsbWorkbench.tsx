import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { DEFAULT_LSB_PARAMETERS } from "../../lib/lsbEngine";
import { MAX_LSB_FILE_BYTES, validateImageDimensions } from "../../lib/localFileLimits";
import { OperationGeneration } from "../../lib/operationGeneration";
import { parsePaletteIndexes } from "../../lib/pngPalette";
import type { LsbLocalAnalysis } from "../../lib/lsbTypes";
import { LsbWorkerClient } from "../../lib/lsbWorkerClient";
import { LsbParameterPanel } from "./lsb/LsbParameterPanel";
import { LsbResultsPanel } from "./lsb/LsbResultsPanel";
import { LsbSourcePanel } from "./lsb/LsbSourcePanel";

interface LsbWorkbenchProps {
  analysis?: LsbLocalAnalysis;
  flagPrefixes: readonly string[];
  flagCaseSensitive: boolean;
  flagEnabled: boolean;
  onAnalysisChange: (analysis: LsbLocalAnalysis) => void;
  onClear: () => void;
}

function initialAnalysis(): LsbLocalAnalysis {
  return {
    kind: "lsb",
    status: "idle",
    mode: "auto",
    depth: "quick",
    parameters: {
      ...DEFAULT_LSB_PARAMETERS,
      sources: DEFAULT_LSB_PARAMETERS.sources.map((source) => ({ ...source })),
      scan: { ...DEFAULT_LSB_PARAMETERS.scan },
    },
    candidates: [],
  };
}

function decodePixels(sourceUrl: string) {
  return new Promise<{ width: number; height: number; rgba: Uint8Array }>((resolve, reject) => {
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
      if (!context) {
        reject(new Error("当前环境无法读取图片像素"));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve({ width: canvas.width, height: canvas.height, rgba: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) });
    });
    image.addEventListener("error", () => reject(new Error("图片格式无法解码")));
    image.src = sourceUrl;
  });
}

export function LsbWorkbench({ analysis: provided, flagPrefixes, flagCaseSensitive, flagEnabled, onAnalysisChange, onClear }: LsbWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<LsbWorkerClient>();
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
  const getClient = () => {
    clientRef.current ??= new LsbWorkerClient();
    return clientRef.current;
  };
  const update = (patch: Partial<LsbLocalAnalysis>) => {
    const next = { ...analysisRef.current, ...patch };
    analysisRef.current = next;
    onAnalysisChange(next);
  };

  const loadFile = async (file: File) => {
    const generation = generationRef.current.begin();
    clientRef.current?.cancel();
    revokePreview();
    if (file.size > MAX_LSB_FILE_BYTES) {
      update({ status: "failed", fileName: file.name, fileSize: file.size, dataUrl: undefined, source: undefined, candidates: [], error: "文件超过 64 MiB 限制" });
      return;
    }
    update({ status: "loading", fileName: file.name, fileSize: file.size, dataUrl: undefined, source: undefined, candidates: [], selectedId: undefined, error: undefined });
    const previewUrl = URL.createObjectURL(file);
    try {
      const [bytes, pixels] = await Promise.all([
        file.arrayBuffer().then((value) => new Uint8Array(value)),
        decodePixels(previewUrl),
      ]);
      if (!generationRef.current.isCurrent(generation)) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      const palette = parsePaletteIndexes(bytes);
      previewUrlRef.current = previewUrl;
      update({
        status: "idle",
        fileName: file.name,
        fileSize: file.size,
        dataUrl: previewUrl,
        source: { ...pixels, paletteIndices: palette.supported ? palette.indexes : undefined },
        candidates: [],
        selectedId: undefined,
        error: undefined,
      });
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "failed", source: undefined, candidates: [], error: error instanceof Error ? error.message : String(error) });
    }
  };

  const run = async () => {
    const current = analysisRef.current;
    if (!current.source) return;
    if (current.status === "running") {
      generationRef.current.invalidate();
      getClient().cancel();
      update({ status: "cancelled", progress: undefined });
      return;
    }
    const generation = generationRef.current.begin();
    update({ status: "running", candidates: [], selectedId: undefined, error: undefined, progress: undefined });
    try {
      if (current.mode === "auto") {
        const candidates = await getClient().auto(current.source, {
          depth: current.depth,
          prefixes: flagEnabled ? flagPrefixes : [],
          caseSensitive: flagCaseSensitive,
          onProgress: (progress) => {
            if (generationRef.current.isCurrent(generation)) update({ progress });
          },
        });
        if (!generationRef.current.isCurrent(generation)) return;
        update({ status: "completed", candidates, selectedId: candidates[0]?.id, progress: undefined });
      } else {
        const candidate = await getClient().manual(current.source, current.parameters, { prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive });
        if (!generationRef.current.isCurrent(generation)) return;
        update({ status: "completed", candidates: [candidate], selectedId: candidate.id, progress: undefined });
      }
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      if (error instanceof Error && error.name === "AbortError") update({ status: "cancelled", progress: undefined });
      else update({ status: "failed", progress: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const applyCandidate = async (candidate: LsbLocalAnalysis["candidates"][number]) => {
    const source = analysisRef.current.source;
    if (!source) return;
    const parameters = {
      ...candidate.parameters,
      sources: candidate.parameters.sources.map((item) => ({ ...item })),
      scan: { ...candidate.parameters.scan },
    };
    const generation = generationRef.current.begin();
    update({ mode: "manual", parameters, status: "running", selectedId: candidate.id, error: undefined, progress: undefined });
    try {
      const extracted = await getClient().manual(source, parameters, { prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive });
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "completed", candidates: [extracted], selectedId: extracted.id });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      if (error instanceof Error && error.name === "AbortError") update({ status: "cancelled" });
      else update({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const exportBytes = (bytes: Uint8Array, fileName: string, mediaType: string) => {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="local-workbench misc-workbench lsb-workbench">
    <div className="local-tool-strip">
      <div><span>Misc / LSB 隐写</span><strong>自动搜索与完整手动位流提取</strong></div>
      <div className="local-tool-actions">
        <button type="button" className="secondary-action" onClick={() => { generationRef.current.invalidate(); clientRef.current?.cancel(); revokePreview(); onClear(); }}><RotateCcw size={14} />清空</button>
        <button type="button" className="run-action" disabled={!analysis.source || analysis.status === "loading"} onClick={() => void run()}>{analysis.status === "running" ? <Square size={13} /> : <Play size={14} />}{analysis.status === "running" ? "取消" : analysis.mode === "auto" ? "开始分析" : "提取数据"}</button>
      </div>
    </div>
    <div className="misc-workspace-grid lsb-workspace-grid">
      <section className="asset-stage">
        <header className="local-section-header"><div><strong>输入与位平面</strong><span>{analysis.fileName ?? "尚未载入文件"}</span></div></header>
        <LsbSourcePanel analysis={analysis} disabled={analysis.status === "running" || analysis.status === "loading"} onFile={(file) => void loadFile(file)} />
      </section>
      <section className="analysis-inspector">
        <header className="local-section-header"><div><strong>分析参数</strong><span>{analysis.mode === "auto" ? "候选自动排序" : "所见参数即实际顺序"}</span></div></header>
        <LsbParameterPanel analysis={analysis} disabled={analysis.status === "running" || analysis.status === "loading"} onChange={onAnalysisChange} />
      </section>
      <section className="extraction-results">
        <header className="local-section-header"><div><strong>提取结果</strong><span>{analysis.progress ? `${analysis.progress.stage} · 已测试 ${analysis.progress.tested}` : analysis.candidates.length ? `${analysis.candidates.length} 个候选` : "运行后显示数据和文件"}</span></div></header>
        <LsbResultsPanel analysis={analysis} onSelect={(candidate) => update({ selectedId: candidate.id })} onApply={(candidate) => void applyCandidate(candidate)} onExport={exportBytes} />
      </section>
    </div>
  </section>;
}
