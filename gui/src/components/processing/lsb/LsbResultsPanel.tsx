import { Check, Copy, Download, FileArchive, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { bytesToHexPreview } from "../../../lib/lsbFormats";
import type { LsbCandidate, LsbExtractedFile, LsbLocalAnalysis } from "../../../lib/lsbTypes";

interface LsbResultsPanelProps {
  analysis: LsbLocalAnalysis;
  onSelect: (candidate: LsbCandidate) => void;
  onApply: (candidate: LsbCandidate) => void;
  onExport: (bytes: Uint8Array, fileName: string, mediaType: string) => void;
}

function sourceSummary(candidate: LsbCandidate) {
  return candidate.parameters.sources.map((source) => `${source.channel}${source.bit}`).join(",");
}

function scanSummary(candidate: LsbCandidate) {
  const { scan } = candidate.parameters;
  return `${scan.major === "row" ? "逐行" : "逐列"} · ${scan.x === "left-to-right" ? "左→右" : "右→左"} · ${scan.y === "top-to-bottom" ? "上→下" : "下→上"}${scan.serpentine ? " · 蛇形" : ""}`;
}

function extension(mediaType: string) {
  const extensions: Record<string, string> = {
    "application/zip": "zip",
    "application/gzip": "gz",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return extensions[mediaType] ?? "bin";
}

function safeBaseName(fileName?: string) {
  return (fileName ?? "lsb-result").replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-") || "lsb-result";
}

function flagFromEvidence(evidence: readonly string[]) {
  const prefixes = ["发现 Flag：", "疑似 Flag：", "归档内发现 Flag：", "归档内发现疑似 Flag："];
  for (const item of evidence) {
    const prefix = prefixes.find((candidate) => item.startsWith(candidate));
    if (prefix) return item.slice(prefix.length).trim();
  }
  return undefined;
}

function FileTree({ file, baseName, onExport }: { file: LsbExtractedFile; baseName: string; onExport: LsbResultsPanelProps["onExport"] }) {
  return <li className="lsb-file-node">
    <div>{file.children ? <FileArchive size={13} /> : <FileText size={13} />}<span><strong>{file.name}</strong><small>{file.mediaType} · {file.bytes.length} 字节{file.offset ? ` · 偏移 ${file.offset}` : ""}</small></span><button type="button" className="icon-action" title={`导出 ${file.name}`} disabled={file.bytes.length === 0} onClick={() => onExport(file.bytes, file.name || `${baseName}.${extension(file.mediaType)}`, file.mediaType)}><Download size={13} /></button></div>
    {file.warning && <p className="lsb-file-warning">{file.warning}</p>}
    {file.text !== undefined && <pre>{file.text}</pre>}
    {file.children && <ul>{file.children.map((child, index) => <FileTree key={`${child.name}-${index}`} file={child} baseName={baseName} onExport={onExport} />)}</ul>}
  </li>;
}

export function LsbResultsPanel({ analysis, onSelect, onApply, onExport }: LsbResultsPanelProps) {
  const [tab, setTab] = useState<"text" | "hex" | "files">("text");
  const [copiedFlag, setCopiedFlag] = useState<string>();
  const selected = useMemo(
    () => analysis.candidates.find((candidate) => candidate.id === analysis.selectedId) ?? analysis.candidates[0],
    [analysis.candidates, analysis.selectedId],
  );

  if (!selected) return <div className={analysis.error ? "extraction-empty extraction-error" : "extraction-empty"}>
    <span>{analysis.error ?? (analysis.status === "running" ? "正在分析候选数据" : "运行后显示候选数据")}</span>
    <small>{analysis.progress ? `${analysis.progress.stage} · ${analysis.progress.tested} 项` : "文本、文件和 Flag 会集中显示在这里"}</small>
  </div>;

  const baseName = safeBaseName(analysis.fileName);
  const rank = analysis.candidates.indexOf(selected) + 1;
  const text = selected.preview;
  const exportName = `${baseName}-rank${rank}.${extension(selected.mediaType)}`;
  const detectedFlag = flagFromEvidence(selected.evidence);
  const flagCopied = detectedFlag !== undefined && copiedFlag === detectedFlag;

  return <div className="lsb-results-layout">
    <div className="lsb-candidate-list" aria-label="自动分析候选">
      {analysis.candidates.map((candidate, index) => <button type="button" key={candidate.id} className={candidate.id === selected.id ? "lsb-candidate lsb-candidate-selected" : "lsb-candidate"} onClick={() => onSelect(candidate)}>
        <span className="lsb-rank">#{index + 1}</span>
        <span className="lsb-candidate-main"><strong>{candidate.preview.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 80) || candidate.mediaType}</strong><small>{sourceSummary(candidate)} · {scanSummary(candidate)}</small></span>
        <span className="lsb-score">{candidate.score} 分</span>
      </button>)}
    </div>
    <article className="lsb-result-detail">
      <header>
        <div><strong>{selected.mediaType}</strong><span>{selected.bytes.length} 字节 · {sourceSummary(selected)}</span></div>
        <div className="lsb-result-actions">
          {detectedFlag && <button type="button" className="icon-action" title={flagCopied ? "已复制 Flag" : "复制疑似 Flag"} aria-label={flagCopied ? "已复制 Flag" : "复制疑似 Flag"} onClick={async () => {
            await navigator.clipboard.writeText(detectedFlag);
            setCopiedFlag(detectedFlag);
          }}>{flagCopied ? <Check size={13} /> : <Copy size={13} />}</button>}
          <button type="button" className="secondary-action" title="应用参数" onClick={() => onApply(selected)}><Check size={13} />应用参数</button>
          <button type="button" className="icon-action" title="导出原始字节" onClick={() => onExport(selected.bytes, exportName, selected.mediaType)}><Download size={13} /></button>
        </div>
      </header>
      {selected.evidence.length > 0 && <div className="lsb-evidence">{selected.evidence.map((item) => <span key={item}>{item}</span>)}</div>}
      <div className="lsb-result-tabs">
        <button type="button" title="查看文本" className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>文本</button>
        <button type="button" title="查看 Hex" className={tab === "hex" ? "active" : ""} onClick={() => setTab("hex")}>Hex</button>
        <button type="button" title="查看文件" className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>文件 {selected.files.length}</button>
      </div>
      <pre className="lsb-result-text" hidden={tab !== "text"}>{text}</pre>
      <pre className="lsb-result-hex" hidden={tab !== "hex"}>{bytesToHexPreview(selected.bytes, 16 * 1024)}</pre>
      <div className="lsb-result-files" hidden={tab !== "files"}>{selected.files.length ? <ul>{selected.files.map((file, index) => <FileTree key={`${file.name}-${index}`} file={file} baseName={baseName} onExport={onExport} />)}</ul> : <span>未识别到可雕刻文件</span>}</div>
    </article>
  </div>;
}
