import { Download, FileArchive, ScanSearch } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AudioLocalAnalysis, AudioVisual } from "../../../lib/audioTypes";
import type { LsbExtractedFile } from "../../../lib/lsbTypes";

interface AudioResultsPanelProps {
  analysis: AudioLocalAnalysis;
  onTab: (tab: AudioLocalAnalysis["selectedTab"]) => void;
  onExport: (bytes: Uint8Array, fileName: string, mediaType: string) => void;
}

const TABS: Array<[AudioLocalAnalysis["selectedTab"], string]> = [
  ["overview", "总览"], ["spectrogram", "频谱图"], ["waveform", "波形"], ["strings", "字符串"], ["files", "雕刻文件"],
];

function offset(value?: number) {
  return value === undefined ? "-" : `0x${value.toString(16)}`;
}

function VisualCanvas({ visual }: { visual: AudioVisual }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(visual.pixels.length);
    pixels.set(visual.pixels);
    context.putImageData(new ImageData(pixels, visual.width, visual.height), 0, 0);
  }, [visual]);
  return <figure className="stego-visual audio-visual-figure"><canvas ref={ref} width={visual.width} height={visual.height} aria-label={visual.label} /><figcaption><strong>{visual.label}</strong>{visual.detail && <span>{visual.detail}</span>}</figcaption></figure>;
}

function CarvedFile({ file, onExport }: { file: LsbExtractedFile; onExport: AudioResultsPanelProps["onExport"] }) {
  return <li className="stego-file"><div><FileArchive size={14} /><span><strong>{file.name}</strong><small>{file.mediaType} · {file.bytes.length} 字节 · {offset(file.offset)}</small></span><button type="button" className="icon-action" title={`导出 ${file.name}`} aria-label={`导出 ${file.name}`} onClick={() => onExport(file.bytes, file.name, file.mediaType)}><Download size={13} /></button></div>{file.text && <pre>{file.text.slice(0, 4096)}</pre>}</li>;
}

export function AudioResultsPanel({ analysis, onTab, onExport }: AudioResultsPanelProps) {
  const report = analysis.report;
  const waveforms = report?.visuals.filter((visual) => visual.kind === "waveform") ?? [];
  const spectrograms = report?.visuals.filter((visual) => visual.kind === "spectrogram") ?? [];
  return <div className="stego-results audio-results">
    <div className="stego-result-tabs" role="tablist">{TABS.map(([id, label]) => <button type="button" role="tab" aria-selected={analysis.selectedTab === id} aria-label={`查看${label}`} className={analysis.selectedTab === id ? "active" : ""} disabled={!report} key={id} onClick={() => onTab(id)}>{label}{id === "files" && report && report.carvedFiles.length > 0 ? ` ${report.carvedFiles.length}` : ""}</button>)}</div>
    {!report ? <div className="extraction-empty"><ScanSearch size={24} /><span>{analysis.error ?? (analysis.fileName ? "参数已就绪" : "载入音频后开始分析")}</span><small>波形、频谱、LSB、声道差分与字符串证据会集中显示</small></div> : <div className="stego-result-body">
      <section hidden={analysis.selectedTab !== "overview"} className="stego-overview">
        <div className="stego-summary"><span>格式<strong>{report.track.format}</strong></span><span>采样率<strong>{report.track.sampleRate} Hz</strong></span><span>声道<strong>{report.track.channels}</strong></span><span>时长<strong>{report.track.durationSeconds.toFixed(2)} s</strong></span><span>字符串<strong>{report.strings.length}</strong></span></div>
        {report.findings.length ? <div className="stego-findings">{report.findings.map((finding) => <article className={`stego-finding stego-finding-${finding.severity}`} key={finding.id}><span>{finding.source}{finding.offset !== undefined ? ` · ${offset(finding.offset)}` : ""}</span><strong>{finding.title}</strong><p>{finding.detail}</p></article>)}</div> : <div className="stego-empty-inline">当前模块未发现高置信异常</div>}
      </section>
      <section hidden={analysis.selectedTab !== "spectrogram"} className="stego-visual-grid">{spectrograms.length ? spectrograms.map((visual) => <VisualCanvas key={visual.id} visual={visual} />) : <div className="stego-empty-inline">未生成频谱图</div>}</section>
      <section hidden={analysis.selectedTab !== "waveform"} className="stego-visual-grid">{waveforms.length ? waveforms.map((visual) => <VisualCanvas key={visual.id} visual={visual} />) : <div className="stego-empty-inline">未生成波形</div>}</section>
      <section hidden={analysis.selectedTab !== "strings"}><table className="stego-table"><thead><tr><th>编码</th><th>偏移</th><th>文本</th><th>来源</th></tr></thead><tbody>{report.strings.map((hit, index) => <tr key={`${hit.offset}-${hit.encoding}-${index}`}><td>{hit.encoding}</td><td>{offset(hit.offset)}</td><td className="stego-value">{hit.text}</td><td>{hit.decodedFrom ?? "原始"}</td></tr>)}</tbody></table>{report.metadata.length > 0 && <table className="stego-table"><thead><tr><th>分组</th><th>字段</th><th>值</th></tr></thead><tbody>{report.metadata.map((entry, index) => <tr key={`${entry.key}-${index}`}><td>{entry.group}</td><td>{entry.key}</td><td className="stego-value">{entry.value}</td></tr>)}</tbody></table>}</section>
      <section hidden={analysis.selectedTab !== "files"} className="stego-files">{report.carvedFiles.length ? <ul>{report.carvedFiles.map((file, index) => <CarvedFile key={`${file.name}-${index}`} file={file} onExport={onExport} />)}</ul> : <div className="stego-empty-inline">未识别到可雕刻文件</div>}</section>
    </div>}
  </div>;
}
