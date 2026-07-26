import { Download, ScanSearch, ShieldCheck } from "lucide-react";
import type { ZipEntryFinding, ZipLocalAnalysis } from "../../../lib/zipTypes";

interface FakeEncResultsPanelProps {
  analysis: ZipLocalAnalysis;
  onExport: () => void;
}

const METHOD_LABEL: Record<ZipEntryFinding["method"], string> = {
  stored: "Stored", deflate: "Deflate", aes: "AES", other: "其他",
};

function Marker({ set }: { set: boolean }) {
  return <span className={set ? "fakeenc-bit set" : "fakeenc-bit"} aria-hidden="true" />;
}

export function FakeEncResultsPanel({ analysis, onExport }: FakeEncResultsPanelProps) {
  const report = analysis.report;
  const canExport = Boolean(report && report.repairable > 0 && analysis.options.repairMode !== "report");
  if (!report) {
    return <div className="extraction-empty"><ScanSearch size={24} /><span>{analysis.error ?? (analysis.fileName ? "参数已就绪" : "载入 ZIP 后开始检测")}</span><small>逐条目的加密标记、伪加密判定与 Flag 命中会集中显示</small></div>;
  }
  return <div className="fakeenc-results">
    <div className="fakeenc-results-summary">
      <span><strong>{report.entries.length}</strong> 个条目异常</span>
      <span><strong>{report.repairable}</strong> 个可修复</span>
      <button type="button" className="run-action" aria-label="导出修复后的 ZIP" disabled={!canExport} onClick={onExport}><Download size={14} />导出修复后的 ZIP</button>
    </div>
    {report.entries.length === 0 ? <div className="extraction-empty"><ShieldCheck size={24} /><span>未发现伪加密标记</span><small>所有条目的加密标记均正常</small></div> : <table className="fakeenc-table">
      <thead><tr><th>文件名</th><th>方法</th><th>L·C</th><th>结论</th></tr></thead>
      <tbody>{report.entries.map((entry, index) => <tr key={`${entry.name}-${index}`} className={`fakeenc-row severity-${entry.severity} ${entry.flagHits.length ? "has-flag" : ""}`}>
        <td>{entry.name}{entry.flagHits.length > 0 && <em className="fakeenc-flag">{entry.flagHits.join("、")}</em>}</td>
        <td>{METHOD_LABEL[entry.method]}</td>
        <td className="fakeenc-markers"><Marker set={entry.localBit0} /><Marker set={entry.centralBit0} /></td>
        <td>{entry.verdict}</td>
      </tr>)}</tbody>
    </table>}
  </div>;
}
