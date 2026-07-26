import { FileArchive, FileUp } from "lucide-react";
import type { ZipLocalAnalysis } from "../../../lib/zipTypes";

interface FakeEncSourcePanelProps {
  analysis: ZipLocalAnalysis;
  disabled: boolean;
  onFile: (file: File) => void;
}

export function FakeEncSourcePanel({ analysis, disabled, onFile }: FakeEncSourcePanelProps) {
  return <div className="asset-stage-content fakeenc-source-panel">
    <label className={`file-drop-zone ${analysis.fileName ? "file-drop-zone-loaded" : ""}`}>
      {analysis.fileName ? <FileArchive size={24} /> : <FileUp size={24} />}
      <strong>{analysis.fileName ?? "拖入 ZIP 或点击选择"}</strong>
      <span>{analysis.fileName ? `${analysis.fileSize ?? 0} 字节` : "支持普通 ZIP 归档，检测伪加密标记并可导出修复包"}</span>
      <input aria-label="选择伪加密分析文件" type="file" accept=".zip" disabled={disabled} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
    {analysis.report && <div className="fakeenc-source-facts"><span>条目总数</span><strong>{analysis.report.entryCount}</strong><span>异常条目</span><strong>{analysis.report.entries.length}</strong><span>可修复</span><strong>{analysis.report.repairable}</strong></div>}
  </div>;
}
