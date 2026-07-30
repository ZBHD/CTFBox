import { FileUp, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { MAX_STEGO_FILE_BYTES } from "../../lib/localFileLimits";
import { OperationGeneration } from "../../lib/operationGeneration";
import type { PcapLocalAnalysis } from "../../lib/pcapTypes";
import { PcapWorkerClient } from "../../lib/pcapWorkerClient";

interface PcapWorkbenchProps {
  analysis?: PcapLocalAnalysis;
  onAnalysisChange: (analysis: PcapLocalAnalysis) => void;
  onClear: () => void;
}

function initialAnalysis(): PcapLocalAnalysis {
  return { kind: "pcap", status: "idle" };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function PcapWorkbench({ analysis: provided, onAnalysisChange, onClear }: PcapWorkbenchProps) {
  const analysis = provided ?? initialAnalysis();
  const analysisRef = useRef(analysis);
  const clientRef = useRef<PcapWorkerClient>();
  const generationRef = useRef(new OperationGeneration());
  analysisRef.current = analysis;
  useEffect(() => () => {
    generationRef.current.invalidate();
    clientRef.current?.dispose();
  }, []);
  const client = () => clientRef.current ??= new PcapWorkerClient();
  const update = (patch: Partial<PcapLocalAnalysis>) => {
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
      update({ status: "cancelled" });
      return;
    }
    const generation = generationRef.current.begin();
    update({ status: "running", report: undefined, error: undefined });
    try {
      const report = await client().analyze(current.bytes);
      if (!generationRef.current.isCurrent(generation)) return;
      update({ status: "completed", report });
    } catch (error) {
      if (!generationRef.current.isCurrent(generation)) return;
      if (error instanceof Error && error.name === "AbortError") update({ status: "cancelled" });
      else update({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const report = analysis.report;
  return <section className="local-workbench misc-workbench pcap-workbench">
    <div className="local-tool-strip">
      <div><span>Misc / PCAP 分析</span><strong>离线解析经典 PCAP 全局头、记录边界与 Ethernet IPv4 端点</strong></div>
      <div className="local-tool-actions">
        <button type="button" className="secondary-action" onClick={() => { generationRef.current.invalidate(); clientRef.current?.cancel(); onClear(); }}><RotateCcw size={14} />清空</button>
        <button type="button" className="run-action" disabled={!analysis.bytes || analysis.status === "loading"} onClick={() => void run()}>{analysis.status === "running" ? <Square size={13} /> : <Play size={14} />}{analysis.status === "running" ? "取消" : "开始分析"}</button>
      </div>
    </div>
    <div className="misc-workspace-grid">
      <section className="asset-stage">
        <header className="local-section-header"><div><strong>输入抓包</strong><span>{analysis.fileName ? `${analysis.fileName} · ${formatBytes(analysis.fileSize ?? 0)}` : "尚未载入 PCAP 文件"}</span></div></header>
        <div className="asset-stage-content"><label className={`file-drop-zone ${analysis.fileName ? "file-drop-zone-loaded" : ""}`}><FileUp size={24} /><strong>{analysis.fileName ?? "拖入文件或点击选择"}</strong><span>支持 .pcap、.cap 与 .pcapng</span><input aria-label="选择 PCAP 文件" type="file" accept=".pcap,.cap,.pcapng,application/vnd.tcpdump.pcap" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void loadFile(file); }} /></label></div>
      </section>
      <section className="analysis-inspector">
        <header className="local-section-header"><div><strong>解析范围</strong><span>当前版本的已实现能力</span></div></header>
        <div className="analysis-inspector-content"><div className="inspector-group"><span className="inspector-label">经典 PCAP</span><p>识别大小端与微秒/纳秒时间戳，验证全局头、记录头和截断边界。</p></div><div className="inspector-group"><span className="inspector-label">网络摘要</span><p>Ethernet 链路层下解析 IPv4、TCP、UDP、ICMP 端点；PCAPNG 仅标记格式，不进行块解析。</p></div></div>
      </section>
      <section className="extraction-results">
        <header className="local-section-header"><div><strong>数据包概览</strong><span>{report ? `${report.packets.length} 条记录 · ${report.findings.length} 条诊断` : analysis.error ?? "运行后显示结构化结果"}</span></div></header>
        <div className="analysis-inspector-content">
          {!report && <div className="extraction-empty"><span>{analysis.fileName ? "文件已就绪" : "载入抓包文件后开始分析"}</span><small>不会上传文件，解析仅在本地 Worker 中执行</small></div>}
          {report && <><div className="inspector-group"><span className="inspector-label">格式</span><p>{report.format === "pcap" ? `经典 PCAP · ${report.byteOrder} · ${report.timestampResolution} · 链路类型 ${report.linkType}` : report.format === "pcapng" ? "PCAPNG（当前仅识别）" : "未知格式"}</p></div>{report.findings.map((finding, index) => <div className="inspection-row" key={`${finding.title}-${index}`}><span className="inspection-check" /><span><strong>{finding.title}</strong><small>{finding.detail}</small></span></div>)}{report.packets.slice(0, 100).map((packet) => <div className="inspection-row" key={packet.offset}><span className="inspection-check" /><span><strong>#{packet.index} {packet.summary?.protocol ?? "原始记录"} · {packet.summary ? `${packet.summary.source} -> ${packet.summary.destination}` : `${packet.capturedLength} 字节`}</strong><small>偏移 0x{packet.offset.toString(16)} · 时间 {packet.timestampSeconds}.{packet.timestampFraction} · 捕获 {packet.capturedLength}/{packet.originalLength} 字节</small></span></div>)}{report.packets.length > 100 && <p>仅展示前 100 条记录。</p>}</>}
        </div>
      </section>
    </div>
  </section>;
}
