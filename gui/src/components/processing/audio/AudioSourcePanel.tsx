import { FileAudio, FileSearch } from "lucide-react";
import type { AudioLocalAnalysis } from "../../../lib/audioTypes";

interface AudioSourcePanelProps {
  analysis: AudioLocalAnalysis;
  disabled: boolean;
  onFile: (file: File) => void;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.00 秒";
  return `${seconds.toFixed(2)} 秒`;
}

export function AudioSourcePanel({ analysis, disabled, onFile }: AudioSourcePanelProps) {
  const pcm = analysis.pcm;
  return <div className="asset-stage-content audio-source-panel">
    <label className={`file-drop-zone ${analysis.fileName ? "file-drop-zone-loaded" : ""}`}>
      {pcm ? <FileAudio size={24} /> : <FileSearch size={24} />}
      <strong>{analysis.fileName ?? "拖入音频或点击选择"}</strong>
      <span>{analysis.fileName ? `${analysis.fileType ?? "audio/*"} · ${analysis.fileSize ?? 0} 字节` : "WAV 获得样本级 LSB，其他格式解码后做频谱/字符串"}</span>
      <input aria-label="选择音频分析文件" type="file" accept="audio/*,.wav" disabled={disabled} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
    {analysis.dataUrl && <audio className="audio-source-player" controls src={analysis.dataUrl} aria-label="音频试听" />}
    {pcm && <div className="audio-source-facts">
      <span>采样率</span><strong>{pcm.sampleRate.toLocaleString()} Hz</strong>
      <span>声道</span><strong>{pcm.channels.length}</strong>
      <span>位深</span><strong>{pcm.lossy ? "有损" : `${pcm.bitDepth} bit`}</strong>
      <span>时长</span><strong>{formatDuration(pcm.channels[0]?.length ? pcm.channels[0].length / pcm.sampleRate : 0)}</strong>
    </div>}
    {analysis.error && <p className="audio-source-error">{analysis.error}</p>}
  </div>;
}
