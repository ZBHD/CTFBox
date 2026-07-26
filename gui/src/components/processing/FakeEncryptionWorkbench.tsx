import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { MAX_STEGO_FILE_BYTES } from "../../lib/localFileLimits";
import { OperationGeneration } from "../../lib/operationGeneration";
import { repairZip } from "../../lib/zipEncryption";
import { DEFAULT_ZIP_OPTIONS, type ZipLocalAnalysis } from "../../lib/zipTypes";
import { ZipWorkerClient } from "../../lib/zipWorkerClient";
import { FakeEncParameterPanel } from "./fakeenc/FakeEncParameterPanel";
import { FakeEncResultsPanel } from "./fakeenc/FakeEncResultsPanel";
import { FakeEncSourcePanel } from "./fakeenc/FakeEncSourcePanel";

interface FakeEncryptionWorkbenchProps {
  analysis?: ZipLocalAnalysis;
  flagPrefixes: readonly string[];
  flagCaseSensitive: boolean;
  flagEnabled: boolean;
  onAnalysisChange: (analysis: ZipLocalAnalysis) => void;
  onClear: () => void;
}

function initialAnalysis(): ZipLocalAnalysis {
  return { kind: "zip", status: "idle", options: { ...DEFAULT_ZIP_OPTIONS } };
}

export function FakeEncryptionWorkbench({ analysis: provided, flagPrefixes, flagCaseSensitive, flagEnabled, onAnalysisChange, onClear }: FakeEncryptionWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<ZipWorkerClient>();
  const generationRef = useRef(new OperationGeneration());
  analysisRef.current = analysis;
  useEffect(() => () => {
    generationRef.current.invalidate();
    clientRef.current?.dispose();
  }, []);
  const client = () => clientRef.current ??= new ZipWorkerClient();
  const update = (patch: Partial<ZipLocalAnalysis>) => {
    const next = { ...analysisRef.current, ...patch };
    analysisRef.current = next;
    onAnalysisChange(next);
  };
  const busy = analysis.status === "loading" || analysis.status === "running";

  const loadFile = async (file: File) => {
    const generation = generationRef.current.begin();
    clientRef.current?.cancel();
    if (file.size > MAX_STEGO_FILE_BYTES) {
      update({ status: "failed", fileName: file.name, fileSize: file.size, bytes: undefined, report: undefined, error: "文件超过 128 MiB 限制" });
      return;
    }
    update({ status: "loading", fileName: file.name, fileSize: file.size, bytes: undefined, report: undefined, error: undefined });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "idle", bytes, report: undefined, error: undefined });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "failed", bytes: undefined, report: undefined, error: error instanceof Error ? error.message : String(error) });
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
      const report = await client().analyze(
        { bytes: current.bytes, options: current.options, prefixes: flagEnabled ? flagPrefixes : [], caseSensitive: flagCaseSensitive },
        (progress) => { if (generationRef.current.isCurrent(generation)) update({ progress }); },
      );
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "completed", report, progress: undefined });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      if (error instanceof Error && error.name === "AbortError") update({ status: "cancelled", progress: undefined });
      else update({ status: "failed", progress: undefined, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const exportRepaired = () => {
    const current = analysisRef.current;
    if (!current.bytes || !current.report) return;
    const patched = repairZip(current.bytes, current.report, current.options);
    const url = URL.createObjectURL(new Blob([patched.buffer as ArrayBuffer], { type: "application/zip" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    const base = (current.fileName ?? "archive.zip").replace(/\.zip$/i, "").replace(/[<>:"/\\|?*]+/g, "-");
    anchor.download = `${base}-fixed.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="local-workbench misc-workbench fakeenc-workbench">
    <div className="local-tool-strip">
      <div><span>Misc / 伪加密</span><strong>解析 ZIP 结构，区分真/伪加密并导出修复包</strong></div>
      <div className="local-tool-actions">
        <button type="button" className="secondary-action" onClick={() => { generationRef.current.invalidate(); clientRef.current?.cancel(); onClear(); }}><RotateCcw size={14} />清空</button>
        <button type="button" className="run-action" disabled={!analysis.bytes || analysis.status === "loading"} onClick={() => void run()}>{analysis.status === "running" ? <Square size={13} /> : <Play size={14} />}{analysis.status === "running" ? "取消" : "检测并修复"}</button>
      </div>
    </div>
    <div className="misc-workspace-grid">
      <section className="asset-stage"><header className="local-section-header"><div><strong>输入文件</strong><span>{analysis.fileName ?? "尚未载入文件"}</span></div></header><FakeEncSourcePanel analysis={analysis} disabled={busy} onFile={(file) => void loadFile(file)} /></section>
      <section className="analysis-inspector"><header className="local-section-header"><div><strong>分析参数</strong><span>CTFBox 内置 ZIP 解析与 CRC 验证</span></div></header><FakeEncParameterPanel analysis={analysis} disabled={busy} onChange={onAnalysisChange} /></section>
      <section className="extraction-results"><header className="local-section-header"><div><strong>检测结果</strong><span>{analysis.progress ? `${analysis.progress.stage} · ${analysis.progress.completed}/${analysis.progress.total}` : analysis.report ? `${analysis.report.entries.length} 条异常` : "运行后显示逐条目判定"}</span></div></header><FakeEncResultsPanel analysis={analysis} onExport={exportRepaired} /></section>
    </div>
  </section>;
}
