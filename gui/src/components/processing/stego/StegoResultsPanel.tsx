import { Download, FileArchive, ScanSearch } from "lucide-react";
import { useEffect, useRef } from "react";
import type { LsbExtractedFile } from "../../../lib/lsbTypes";
import type { StegoLocalAnalysis, StegoVisual } from "../../../lib/stegoTypes";

interface StegoResultsPanelProps {
  analysis: StegoLocalAnalysis;
  onTab: (tab: StegoLocalAnalysis["selectedTab"]) => void;
  onExport: (bytes: Uint8Array, fileName: string, mediaType: string) => void;
}

const TABS: Array<[StegoLocalAnalysis["selectedTab"], string]> = [
  ["overview", "总览"], ["metadata", "元数据"], ["structure", "结构"], ["strings", "字符串"], ["visuals", "可视化"], ["dct", "DCT"], ["files", "雕刻文件"],
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

function CarvedFile({ file, onExport }: { file: LsbExtractedFile; onExport: StegoResultsPanelProps["onExport"] }) {
  return <li className="stego-file"><div><FileArchive size={14} /><span><strong>{file.name}</strong><small>{file.mediaType} · {file.bytes.length} 字节 · {offset(file.offset)}</small></span><button type="button" className="icon-action" title={`导出 ${file.name}`} aria-label={`导出 ${file.name}`} onClick={() => onExport(file.bytes, file.name, file.mediaType)}><Download size={13} /></button></div>{file.warning && <p>{file.warning}</p>}{file.text && <pre>{file.text.slice(0, 4096)}</pre>}{file.children && <ul>{file.children.map((child, index) => <CarvedFile key={`${child.name}-${index}`} file={child} onExport={onExport} />)}</ul>}</li>;
}

export function StegoResultsPanel({ analysis, onTab, onExport }: StegoResultsPanelProps) {
  const report = analysis.report;
  return <div className="stego-results">
    <div className="stego-result-tabs" role="tablist">{TABS.map(([id, label]) => <button type="button" role="tab" aria-selected={analysis.selectedTab === id} aria-label={`查看${label}`} className={analysis.selectedTab === id ? "active" : ""} disabled={!report} key={id} onClick={() => onTab(id)}>{label}{id === "files" && report && report.carvedFiles.length > 0 ? ` ${report.carvedFiles.length}` : ""}</button>)}</div>
    {!report ? <div className="extraction-empty"><ScanSearch size={24} /><span>{analysis.error ?? (analysis.fileName ? "参数已就绪" : "载入文件后开始分析")}</span><small>结构、元数据、字符串、DCT 与频域证据会集中显示</small></div> : <div className="stego-result-body">
      <section hidden={analysis.selectedTab !== "overview"} className="stego-overview">
        <div className="stego-summary"><span>识别格式<strong>{report.format}</strong></span><span>结构区段<strong>{report.sections.length}</strong></span><span>元数据<strong>{report.metadata.length}</strong></span><span>字符串<strong>{report.strings.length}</strong></span><span>规范结束<strong>{offset(report.logicalEnd)}</strong></span></div>
        {report.findings.length ? <div className="stego-findings">{report.findings.map((finding) => <article className={`stego-finding stego-finding-${finding.severity}`} key={finding.id}><span>{finding.source}{finding.offset !== undefined ? ` · ${offset(finding.offset)}` : ""}</span><strong>{finding.title}</strong><p>{finding.detail}</p></article>)}</div> : <div className="stego-empty-inline">当前模块未发现高置信异常</div>}
      </section>
      <section hidden={analysis.selectedTab !== "metadata"}><table className="stego-table"><thead><tr><th>分组</th><th>字段</th><th>值</th><th>偏移</th></tr></thead><tbody>{report.metadata.map((entry, index) => <tr key={`${entry.group}-${entry.key}-${index}`}><td>{entry.group}</td><td>{entry.key}</td><td className="stego-value">{entry.value}</td><td>{offset(entry.offset)}</td></tr>)}</tbody></table></section>
      <section hidden={analysis.selectedTab !== "structure"}><table className="stego-table"><thead><tr><th>区段</th><th>偏移</th><th>长度</th><th>状态 / 说明</th></tr></thead><tbody>{report.sections.map((section, index) => <tr key={`${section.offset}-${index}`}><td>{section.name}</td><td>{offset(section.offset)}</td><td>{section.length}</td><td>{section.status ?? "-"}{section.detail ? ` · ${section.detail}` : ""}</td></tr>)}</tbody></table></section>
      <section hidden={analysis.selectedTab !== "strings"}><table className="stego-table"><thead><tr><th>编码</th><th>偏移</th><th>文本</th><th>来源</th></tr></thead><tbody>{report.strings.map((hit, index) => <tr key={`${hit.offset}-${hit.encoding}-${index}`}><td>{hit.encoding}</td><td>{offset(hit.offset)}</td><td className="stego-value">{hit.text}</td><td>{hit.decodedFrom ?? "原始"}</td></tr>)}</tbody></table></section>
      <section hidden={analysis.selectedTab !== "visuals"} className="stego-visual-grid">{report.visuals.map((visual) => <VisualCanvas key={visual.id} visual={visual} />)}</section>
      <section hidden={analysis.selectedTab !== "dct"} className="stego-dct">{report.dct ? <><div className="stego-summary"><span>状态<strong>{report.dct.supported ? "已解析" : "不支持"}</strong></span><span>图像<strong>{report.dct.width ?? 0} x {report.dct.height ?? 0}</strong></span><span>分量<strong>{report.dct.components ?? 0}</strong></span><span>DCT 块<strong>{report.dct.blocks ?? 0}</strong></span><span>AC 零值率<strong>{((report.dct.zeroAcRatio ?? 0) * 100).toFixed(2)}%</strong></span></div>{report.dct.reason && <p>{report.dct.reason}</p>}<div className="stego-parity-grid">{(report.dct.oddRatios ?? []).map((ratio, index) => <span key={index} title={`Zig-zag ${index}: ${(ratio * 100).toFixed(2)}%`} style={{ "--ratio": ratio } as React.CSSProperties}><small>{index}</small></span>)}</div></> : <div className="stego-empty-inline">当前文件没有 JPEG DCT 报告</div>}</section>
      <section hidden={analysis.selectedTab !== "files"} className="stego-files">{report.carvedFiles.length ? <ul>{report.carvedFiles.map((file, index) => <CarvedFile key={`${file.name}-${index}`} file={file} onExport={onExport} />)}</ul> : <div className="stego-empty-inline">未识别到可雕刻文件</div>}</section>
    </div>}
  </div>;
}
