import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { DEFAULT_LSB_PARAMETERS } from "../../lib/lsbEngine";
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

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取图片失败")));
    reader.readAsDataURL(file);
  });
}

function decodePixels(dataUrl: string) {
  return new Promise<{ width: number; height: number; rgba: Uint8Array }>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      if (image.naturalWidth > 10_000 || image.naturalHeight > 10_000) {
        reject(new Error("图片尺寸超过 10000 × 10000 限制"));
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
    image.src = dataUrl;
  });
}

export function LsbWorkbench({ analysis: provided, flagPrefixes, flagCaseSensitive, flagEnabled, onAnalysisChange, onClear }: LsbWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<LsbWorkerClient>();
  analysisRef.current = analysis;

  useEffect(() => () => clientRef.current?.dispose(), []);
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
    clientRef.current?.cancel();
    if (file.size > 512 * 1024 * 1024) {
      update({ status: "failed", fileName: file.name, fileSize: file.size, source: undefined, candidates: [], error: "文件超过 512 MiB 限制" });
      return;
    }
    update({ status: "loading", fileName: file.name, fileSize: file.size, source: undefined, candidates: [], selectedId: undefined, error: undefined });
    try {
      const [bytes, dataUrl] = await Promise.all([file.arrayBuffer().then((value) => new Uint8Array(value)), readDataUrl(file)]);
      const pixels = await decodePixels(dataUrl);
      const palette = parsePaletteIndexes(bytes);
      update({
        status: "idle",
        fileName: file.name,
        fileSize: file.size,
        dataUrl,
        source: { ...pixels, paletteIndices: palette.supported ? palette.indexes : undefined },
        candidates: [],
        selectedId: undefined,
        error: undefined,
      });
    } catch (error) {
      update({ status: "failed", source: undefined, candidates: [], error: error instanceof Error ? error.message : String(error) });
    }
  };

  const run = async () => {
    if (!analysis.source) return;
    if (analysis.status === "running") {
      getClient().cancel();
      return;
    }
    update({ status: "running", candidates: [], selectedId: undefined, error: undefined, progress: undefined });
    try {
      if (analysis.mode === "auto") {
        const candidates = await getClient().auto(analysis.source, {
          depth: analysis.depth,
          prefixes: flagEnabled ? flagPrefixes : [],
          caseSensitive: flagCaseSensitive,
          onProgress: (progress) => update({ progress }),
        });
        update({ status: "completed", candidates, selectedId: candidates[0]?.id, progress: undefined });
      } else {
        const candidate = await getClient().manual(analysis.source, analysis.parameters, { prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive });
        update({ status: "completed", candidates: [candidate], selectedId: candidate.id, progress: undefined });
      }
    } catch (error) {
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
    update({ mode: "manual", parameters, status: "running", selectedId: candidate.id, error: undefined, progress: undefined });
    try {
      const extracted = await getClient().manual(source, parameters, { prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive });
      update({ status: "completed", candidates: [extracted], selectedId: extracted.id });
    } catch (error) {
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
        <button type="button" className="secondary-action" onClick={() => { clientRef.current?.cancel(); onClear(); }}><RotateCcw size={14} />清空</button>
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
