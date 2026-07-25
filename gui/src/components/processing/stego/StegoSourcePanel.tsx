import { FileImage, FileSearch } from "lucide-react";
import type { StegoLocalAnalysis } from "../../../lib/stegoTypes";

interface StegoSourcePanelProps {
  analysis: StegoLocalAnalysis;
  disabled: boolean;
  onFile: (file: File) => void;
}

export function StegoSourcePanel({ analysis, disabled, onFile }: StegoSourcePanelProps) {
  return <div className="asset-stage-content stego-source-panel">
    <label className={`file-drop-zone ${analysis.fileName ? "file-drop-zone-loaded" : ""}`}>
      {analysis.dataUrl ? <FileImage size={24} /> : <FileSearch size={24} />}
      <strong>{analysis.fileName ?? "拖入文件或点击选择"}</strong>
      <span>{analysis.fileName ? `${analysis.fileType ?? "application/octet-stream"} · ${analysis.fileSize ?? 0} 字节` : "图片获得完整像素分析，其他文件执行字节级扫描"}</span>
      <input aria-label="选择隐写分析文件" type="file" disabled={disabled} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
    {analysis.dataUrl && <div className="image-preview stego-image-preview"><img src={analysis.dataUrl} alt="待分析文件图片预览" /></div>}
    {analysis.bytes && <div className="stego-source-facts"><span>原始字节</span><strong>{analysis.bytes.length.toLocaleString()}</strong>{analysis.pixels && <><span>解码尺寸</span><strong>{analysis.pixels.width} x {analysis.pixels.height}</strong></>}</div>}
  </div>;
}
