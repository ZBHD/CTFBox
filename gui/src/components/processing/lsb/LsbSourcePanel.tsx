import { FileImage } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LsbBit, LsbChannel, LsbLocalAnalysis } from "../../../lib/lsbTypes";

interface LsbSourcePanelProps {
  analysis: LsbLocalAnalysis;
  disabled: boolean;
  onFile: (file: File) => void;
}

export function LsbSourcePanel({ analysis, disabled, onFile }: LsbSourcePanelProps) {
  const [channel, setChannel] = useState<LsbChannel | "original">("original");
  const [bit, setBit] = useState<LsbBit | undefined>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const source = analysis.source;
    const canvas = canvasRef.current;
    if (!source || !canvas || channel === "original") return;
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(source.width, source.height);
    const offset = channel === "R" ? 0 : channel === "G" ? 1 : channel === "B" ? 2 : channel === "A" ? 3 : 0;
    for (let index = 0; index < source.width * source.height; index += 1) {
      const value = channel === "I" ? source.paletteIndices?.[index] ?? 0 : source.rgba[index * 4 + offset];
      const rendered = bit === undefined ? value : ((value >> bit) & 1) * 255;
      image.data.set([rendered, rendered, rendered, 255], index * 4);
    }
    context.putImageData(image, 0, 0);
  }, [analysis.source, bit, channel]);

  return <div className="asset-stage-content lsb-source-panel">
    <label className={`file-drop-zone ${analysis.fileName ? "file-drop-zone-loaded" : ""}`}>
      <FileImage size={24} />
      <strong>{analysis.fileName || "拖入文件或点击选择"}</strong>
      <span>{analysis.fileName ? `${analysis.source?.width ?? "?"} × ${analysis.source?.height ?? "?"} · ${analysis.fileSize ?? 0} 字节` : "支持 PNG、BMP、JPEG、GIF 等浏览器图片格式"}</span>
      <input type="file" accept="image/*" disabled={disabled} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
    {analysis.dataUrl && <>
      <div className="lsb-preview-toolbar">
        {(["original", "R", "G", "B", "A"] as const).map((value) => <button type="button" key={value} className={channel === value ? "analysis-option active" : "analysis-option"} onClick={() => setChannel(value)}>{value === "original" ? "原图" : value}</button>)}
        {analysis.source?.paletteIndices && <button type="button" className={channel === "I" ? "analysis-option active" : "analysis-option"} onClick={() => setChannel("I")}>索引</button>}
      </div>
      {channel !== "original" && <div className="bit-plane-options"><button type="button" className={bit === undefined ? "analysis-option active" : "analysis-option"} onClick={() => setBit(undefined)}>通道</button>{Array.from({ length: 8 }, (_, value) => <button type="button" className={bit === value ? "analysis-option active" : "analysis-option"} key={value} onClick={() => setBit(value as LsbBit)}>{value}</button>)}</div>}
      <div className="image-preview lsb-image-preview">{channel === "original" ? <img src={analysis.dataUrl} alt="待分析图片预览" /> : <canvas ref={canvasRef} aria-label={`${channel} 通道预览`} />}</div>
    </>}
  </div>;
}
