import { Copy, Download, FileArchive, ScanSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LsbExtractedFile } from "../../../lib/lsbTypes";
import { decodeSpecialImagePixels } from "../../../lib/stegoImageDecoder";
import { detectImageFormat, encodePngPixels } from "../../../lib/stegoMagic";
import type { StegoLocalAnalysis, StegoRepairCandidate, StegoVisual } from "../../../lib/stegoTypes";

interface StegoResultsPanelProps {
  analysis: StegoLocalAnalysis;
  onTab: (tab: StegoLocalAnalysis["selectedTab"]) => void;
  onExport: (bytes: Uint8Array, fileName: string, mediaType: string) => void;
  onAnalyze: (bytes: Uint8Array, fileName: string, mediaType: string) => void;
}

const TABS: Array<[StegoLocalAnalysis["selectedTab"], string]> = [
  ["overview", "总览"], ["channels", "信道候选"], ["repairs", "修复候选"], ["metadata", "元数据"], ["structure", "结构"], ["strings", "字符串"], ["visuals", "可视化"], ["ocr", "OCR"], ["dct", "DCT"], ["files", "雕刻文件"],
];

function offset(value?: number) {
  return value === undefined ? "-" : `0x${value.toString(16)}`;
}

function VisualCanvas({ visual }: { visual: StegoVisual }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(visual.pixels.length);
    pixels.set(visual.pixels);
    context.putImageData(new ImageData(pixels, visual.width, visual.height), 0, 0);
  }, [visual]);
  return <figure className="stego-visual"><canvas ref={ref} width={visual.width} height={visual.height} aria-label={visual.label} /><figcaption><strong>{visual.label}</strong>{visual.detail && <span>{visual.detail}</span>}</figcaption></figure>;
}

function CandidateImagePreview({ bytes, name, mediaType }: { bytes: Uint8Array; name: string; mediaType: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void (async () => {
      const detected = detectImageFormat(bytes);
      if (!detected && !mediaType.startsWith("image/")) return;
      let previewBytes = bytes;
      let previewType = detected?.mediaType ?? mediaType;
      if (detected) {
        const pixels = await decodeSpecialImagePixels(bytes, detected.format);
        if (pixels) {
          previewBytes = encodePngPixels(pixels);
          previewType = "image/png";
        }
      }
      objectUrl = URL.createObjectURL(new Blob([previewBytes.slice().buffer as ArrayBuffer], { type: previewType }));
      if (cancelled) URL.revokeObjectURL(objectUrl);
      else setUrl(objectUrl);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bytes, mediaType]);
  return url ? <figure className="stego-candidate-preview"><img src={url} alt={`候选图片 ${name}`} aria-label={`预览 ${name}`} /></figure> : null;
}

function repairFileInfo(repair: StegoRepairCandidate) {
  const extension = repair.format === "PNG" ? "png" : repair.format === "BMP" ? "bmp" : repair.format === "GIF" ? "gif" : "jpg";
  return {
    fileName: `repaired-${repair.width}x${repair.height}.${extension}`,
    mediaType: repair.format === "JPEG" ? "image/jpeg" : `image/${extension}`,
  };
}

function CarvedFile({ file, onExport, onAnalyze }: { file: LsbExtractedFile; onExport: StegoResultsPanelProps["onExport"]; onAnalyze: StegoResultsPanelProps["onAnalyze"] }) {
  const isImage = file.mediaType.startsWith("image/") || Boolean(detectImageFormat(file.bytes));
  return <li className="stego-file"><div><FileArchive size={14} /><span><strong>{file.name}</strong><small>{file.mediaType} · {file.bytes.length} 字节 · {offset(file.offset)}</small></span><div className="stego-candidate-actions">{isImage && <button type="button" className="icon-action" title={`继续分析 ${file.name}`} aria-label={`继续分析 ${file.name}`} onClick={() => onAnalyze(file.bytes, file.name, file.mediaType)}><ScanSearch size={13} /></button>}<button type="button" className="icon-action" title={`导出 ${file.name}`} aria-label={`导出 ${file.name}`} onClick={() => onExport(file.bytes, file.name, file.mediaType)}><Download size={13} /></button></div></div>{isImage && <CandidateImagePreview bytes={file.bytes} name={file.name} mediaType={file.mediaType} />}{file.warning && <p>{file.warning}</p>}{file.text && <pre>{file.text.slice(0, 4096)}</pre>}{file.children && <ul>{file.children.map((child, index) => <CarvedFile key={`${child.name}-${index}`} file={child} onExport={onExport} onAnalyze={onAnalyze} />)}</ul>}</li>;
}

export function StegoResultsPanel({ analysis, onTab, onExport, onAnalyze }: StegoResultsPanelProps) {
  const report = analysis.report;
  return <div className="stego-results">
    <div className="stego-result-tabs" role="tablist">{TABS.map(([id, label]) => <button type="button" role="tab" aria-selected={analysis.selectedTab === id} aria-label={`查看${label}`} className={analysis.selectedTab === id ? "active" : ""} disabled={!report} key={id} onClick={() => onTab(id)}>{label}{id === "files" && report && report.carvedFiles.length > 0 ? ` ${report.carvedFiles.length}` : ""}</button>)}</div>
    {!report ? <div className="extraction-empty"><ScanSearch size={24} /><span>{analysis.error ?? (analysis.fileName ? "参数已就绪" : "载入文件后开始分析")}</span><small>结构、元数据、字符串、DCT 与频域证据会集中显示</small></div> : <div className="stego-result-body">
      <section hidden={analysis.selectedTab !== "overview"} className="stego-overview">
        <div className="stego-summary"><span>识别格式<strong>{report.format}</strong></span><span>结构区段<strong>{report.sections.length}</strong></span><span>元数据<strong>{report.metadata.length}</strong></span><span>字符串<strong>{report.strings.length}</strong></span><span>规范结束<strong>{offset(report.logicalEnd)}</strong></span></div>
        {report.findings.length ? <div className="stego-findings">{report.findings.map((finding) => <article className={`stego-finding stego-finding-${finding.severity}`} key={finding.id}><span>{finding.source}{finding.offset !== undefined ? ` · ${offset(finding.offset)}` : ""}</span><strong>{finding.title}</strong>{finding.title.includes("Flag") && <button type="button" className="icon-action" title={`复制${finding.title}`} aria-label={`复制${finding.title}`} onClick={() => void navigator.clipboard.writeText(finding.detail)}><Copy size={13} /></button>}<p>{finding.detail}</p></article>)}</div> : <div className="stego-empty-inline">当前模块未发现高置信异常</div>}
      </section>
      <section hidden={analysis.selectedTab !== "channels"} className="stego-channels">{(report.channels ?? []).length ? <div className="stego-findings">{(report.channels ?? []).map((candidate) => <article className={`stego-finding stego-finding-${candidate.confidence === "high" ? "high" : "info"}`} key={candidate.id}><span>{candidate.source} · {candidate.label}</span><strong>{candidate.confidence === "high" ? "高置信信道候选" : "信道候选"}</strong><button type="button" className="icon-action" title="复制信道候选" aria-label="复制信道候选" onClick={() => void navigator.clipboard.writeText(candidate.value)}><Copy size={13} /></button><pre>{candidate.value}</pre><p>{candidate.detail}</p></article>)}</div> : <div className="stego-empty-inline">未识别到可读结构信道</div>}</section>
      <section hidden={analysis.selectedTab !== "repairs"} className="stego-repairs">{(report.repairs ?? []).length ? <div className="stego-findings">{(report.repairs ?? []).map((repair) => {
        const { fileName, mediaType } = repairFileInfo(repair);
        return <article className={`stego-finding stego-finding-${repair.confidence === "exact" ? "suspicious" : "info"}`} key={repair.id}><span>{repair.format} · {repair.confidence === "exact" ? "精确推导" : "候选"}</span><strong>{repair.label}</strong><div className="stego-candidate-actions"><button type="button" className="icon-action" title={`继续分析尺寸修复 ${repair.width} x ${repair.height}`} aria-label={`继续分析尺寸修复 ${repair.width} x ${repair.height}`} onClick={() => onAnalyze(repair.bytes, fileName, mediaType)}><ScanSearch size={13} /></button><button type="button" className="icon-action" title={`导出尺寸修复 ${repair.width} x ${repair.height}`} aria-label={`导出尺寸修复 ${repair.width} x ${repair.height}`} onClick={() => onExport(repair.bytes, fileName, mediaType)}><Download size={13} /></button></div><CandidateImagePreview bytes={repair.bytes} name={fileName} mediaType={mediaType} /><p>{repair.detail}</p></article>;
      })}</div> : <div className="stego-empty-inline">未生成尺寸修复候选</div>}</section>
      <section hidden={analysis.selectedTab !== "metadata"}><table className="stego-table"><thead><tr><th>分组</th><th>字段</th><th>值</th><th>偏移</th></tr></thead><tbody>{report.metadata.map((entry, index) => <tr key={`${entry.group}-${entry.key}-${index}`}><td>{entry.group}</td><td>{entry.key}</td><td className="stego-value">{entry.value}</td><td>{offset(entry.offset)}</td></tr>)}</tbody></table></section>
      <section hidden={analysis.selectedTab !== "structure"}><table className="stego-table"><thead><tr><th>区段</th><th>偏移</th><th>长度</th><th>状态 / 说明</th></tr></thead><tbody>{report.sections.map((section, index) => <tr key={`${section.offset}-${index}`}><td>{section.name}</td><td>{offset(section.offset)}</td><td>{section.length}</td><td>{section.status ?? "-"}{section.detail ? ` · ${section.detail}` : ""}</td></tr>)}</tbody></table></section>
      <section hidden={analysis.selectedTab !== "strings"}><table className="stego-table"><thead><tr><th>编码</th><th>偏移</th><th>文本</th><th>来源</th></tr></thead><tbody>{report.strings.map((hit, index) => <tr key={`${hit.offset}-${hit.encoding}-${index}`}><td>{hit.encoding}</td><td>{offset(hit.offset)}</td><td className="stego-value">{hit.text}</td><td>{hit.decodedFrom ?? "原始"}</td></tr>)}</tbody></table></section>
      <section hidden={analysis.selectedTab !== "visuals"} className="stego-visual-grid">{report.visuals.map((visual) => <VisualCanvas key={visual.id} visual={visual} />)}</section>
      <section hidden={analysis.selectedTab !== "ocr"} className="stego-ocr">{(report.ocr ?? []).length ? <div className="stego-findings">{(report.ocr ?? []).map((result) => <article className={`stego-finding ${result.flags.length > 0 ? "stego-finding-high" : "stego-finding-info"}`} key={result.sourceId}><span>{result.sourceLabel} · 置信度 {result.confidence.toFixed(1)}%</span><strong>{result.error ? "OCR 识别失败" : result.flags.length > 0 ? "识别到 Flag" : "OCR 文本"}</strong>{result.flags.map((flag) => <button type="button" className="icon-action" title={`复制 OCR Flag ${flag}`} aria-label={`复制 OCR Flag ${flag}`} key={flag} onClick={() => void navigator.clipboard.writeText(flag)}><Copy size={13} /></button>)}{result.error ? <p>{result.error}</p> : <pre>{result.text || "未识别到文本"}</pre>}</article>)}</div> : <div className="stego-empty-inline">没有可执行 OCR 的异常帧、修复图或雕刻图</div>}</section>
      <section hidden={analysis.selectedTab !== "dct"} className="stego-dct">{report.dct ? <><div className="stego-summary"><span>状态<strong>{report.dct.supported ? "已解析" : "不支持"}</strong></span><span>图像<strong>{report.dct.width ?? 0} x {report.dct.height ?? 0}</strong></span><span>分量<strong>{report.dct.components ?? 0}</strong></span><span>DCT 块<strong>{report.dct.blocks ?? 0}</strong></span><span>AC 零值率<strong>{((report.dct.zeroAcRatio ?? 0) * 100).toFixed(2)}%</strong></span></div>{report.dct.reason && <p>{report.dct.reason}</p>}<div className="stego-parity-grid">{(report.dct.oddRatios ?? []).map((ratio, index) => <span key={index} title={`Zig-zag ${index}: ${(ratio * 100).toFixed(2)}%`} style={{ "--ratio": ratio } as React.CSSProperties}><small>{index}</small></span>)}</div></> : <div className="stego-empty-inline">当前文件没有 JPEG DCT 报告</div>}</section>
      <section hidden={analysis.selectedTab !== "files"} className="stego-files">{report.carvedFiles.length ? <ul>{report.carvedFiles.map((file, index) => <CarvedFile key={`${file.name}-${index}`} file={file} onExport={onExport} onAnalyze={onAnalyze} />)}</ul> : <div className="stego-empty-inline">未识别到可雕刻文件</div>}</section>
    </div>}
  </div>;
}
