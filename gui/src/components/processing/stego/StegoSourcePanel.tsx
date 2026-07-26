import { FileImage, FileSearch } from "lucide-react";
import type { StegoLocalAnalysis } from "../../../lib/stegoTypes";

interface StegoSourcePanelProps {
  analysis: StegoLocalAnalysis;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}

export function StegoSourcePanel({ analysis, disabled, onFiles }: StegoSourcePanelProps) {
  return <div className="asset-stage-content stego-source-panel">
    <label className={`file-drop-zone ${analysis.fileName ? "file-drop-zone-loaded" : ""}`}>
      {analysis.dataUrl ? <FileImage size={24} /> : <FileSearch size={24} />}
      <strong>{analysis.fileName ?? "拖入文件或点击选择"}</strong>
      <span>{analysis.fileName ? `${analysis.fileType ?? "application/octet-stream"} · ${analysis.fileSize ?? 0} 字节` : "可多选图片自动排序拼接，格式按文件魔数识别"}</span>
      <input aria-label="选择隐写分析文件" type="file" multiple disabled={disabled} onChange={(event) => {
        const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
        event.currentTarget.value = "";
        if (files.length > 0) onFiles(files);
      }} />
    </label>
    {analysis.dataUrl && <div className="image-preview stego-image-preview"><img src={analysis.dataUrl} alt="待分析文件图片预览" /></div>}
    {analysis.bytes && <div className="stego-source-facts"><span>原始字节</span><strong>{analysis.bytes.length.toLocaleString()}</strong>{analysis.pixels && <><span>解码尺寸</span><strong>{analysis.pixels.width} x {analysis.pixels.height}</strong></>}</div>}
    {analysis.batchParts && <ol className="stego-batch-parts">{analysis.batchParts.map((part) => <li key={part.name}><span>{part.name}</span><small>{part.format} · {part.width} x {part.height}</small></li>)}</ol>}
  </div>;
}
