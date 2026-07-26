import type { AudioLocalAnalysis, AudioOptions } from "../../../lib/audioTypes";

interface AudioParameterPanelProps {
  analysis: AudioLocalAnalysis;
  disabled: boolean;
  onChange: (analysis: AudioLocalAnalysis) => void;
}

const CHECKS: Array<{ key: keyof Pick<AudioOptions, "waveform" | "spectrogram" | "lsb" | "channelDiff" | "metadata" | "strings">; label: string; description: string; aria: string; lossySensitive?: boolean }> = [
  { key: "waveform", label: "波形包络", description: "逐声道 min/max 时域包络", aria: "渲染波形" },
  { key: "spectrogram", label: "频谱图 (STFT)", description: "分帧 + 汉宁窗 FFT，检测持续单音", aria: "渲染频谱图" },
  { key: "lsb", label: "LSB 提取", description: "从整数样本低位重建字节流", aria: "提取低位数据", lossySensitive: true },
  { key: "channelDiff", label: "声道差分", description: "L−R 差分波形并重跑低位分析", aria: "分析声道差分", lossySensitive: true },
  { key: "metadata", label: "容器元数据", description: "RIFF INFO 与 data 块后附加数据", aria: "读取元数据" },
  { key: "strings", label: "字符串与 Flag", description: "对原始字节扫描 ASCII/编码文本", aria: "提取字符串" },
];

export function AudioParameterPanel({ analysis, disabled, onChange }: AudioParameterPanelProps) {
  const lossy = analysis.pcm?.lossy ?? false;
  const updateOptions = (patch: Partial<AudioOptions>) => onChange({ ...analysis, options: { ...analysis.options, ...patch } });
  return <div className="analysis-inspector-content audio-parameter-panel">
    <div className="inspector-group">
      <span className="inspector-label">分析模块</span>
      {CHECKS.map((item) => {
        const blocked = disabled || (item.lossySensitive === true && lossy);
        return <label className="stego-check-row" key={item.key}>
          <input aria-label={item.aria} type="checkbox" checked={analysis.options[item.key]} disabled={blocked} onChange={(event) => updateOptions({ [item.key]: event.target.checked })} />
          <span><strong>{item.label}</strong><small>{item.lossySensitive && lossy ? "有损格式无样本级 LSB" : item.description}</small></span>
        </label>;
      })}
    </div>
    <div className="inspector-group">
      <span className="inspector-label">LSB 参数</span>
      <label className="inline-control stacked"><span>位平面数</span><input aria-label="位平面数" type="number" min="1" max="8" value={analysis.options.bitPlanes} disabled={disabled || lossy} onChange={(event) => updateOptions({ bitPlanes: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })} /></label>
      <label className="inline-control stacked"><span>声道掩码</span><input aria-label="声道掩码" value={analysis.options.channelMask} placeholder="LR" disabled={disabled || lossy} onChange={(event) => updateOptions({ channelMask: event.target.value.toUpperCase().replace(/[^LRCS]/g, "") || "L" })} /></label>
      <label className="inline-control stacked"><span>提取顺序</span><select aria-label="提取顺序" value={analysis.options.order} disabled={disabled || lossy} onChange={(event) => updateOptions({ order: event.target.value as AudioOptions["order"] })}><option value="interleaved">交织</option><option value="perChannel">逐声道</option></select></label>
    </div>
    <div className="inspector-group">
      <span className="inspector-label">频谱与扫描</span>
      <label className="inline-control stacked"><span>FFT 窗口</span><select aria-label="FFT 窗口" value={analysis.options.fftSize} disabled={disabled || !analysis.options.spectrogram} onChange={(event) => updateOptions({ fftSize: Number(event.target.value) as AudioOptions["fftSize"] })}><option value="256">256</option><option value="512">512</option><option value="1024">1024</option></select></label>
      <label className="inline-control stacked"><span>最短字符串</span><input aria-label="最短字符串长度" type="number" min="2" max="128" value={analysis.options.minimumStringLength} disabled={disabled} onChange={(event) => updateOptions({ minimumStringLength: Math.max(2, Math.min(128, Number(event.target.value) || 2)) })} /></label>
    </div>
  </div>;
}
