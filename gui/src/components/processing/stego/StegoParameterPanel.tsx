import type { StegoLocalAnalysis, StegoOptions } from "../../../lib/stegoTypes";

interface StegoParameterPanelProps {
  analysis: StegoLocalAnalysis;
  disabled: boolean;
  onChange: (analysis: StegoLocalAnalysis) => void;
}

const CHECKS: Array<{ key: keyof Pick<StegoOptions, "metadata" | "structure" | "trailing" | "strings" | "visuals" | "dct" | "frequency">; label: string; description: string; aria: string }> = [
  { key: "metadata", label: "EXIF / XMP / 文本块", description: "TIFF IFD、PNG 文本、ICC、JPEG APP", aria: "提取元数据" },
  { key: "structure", label: "文件结构", description: "块、标记、长度与 PNG CRC", aria: "分析文件结构" },
  { key: "trailing", label: "尾部附加数据", description: "规范结束位置、熵与嵌套文件", aria: "分析尾部附加数据" },
  { key: "strings", label: "字符串与编码", description: "ASCII、Unicode、GB18030、Base64/Hex/URL", aria: "提取字符串" },
  { key: "visuals", label: "像素视图", description: "RGBA、灰度、拉伸与 8 个位平面", aria: "生成像素视图" },
  { key: "dct", label: "JPEG DCT", description: "量化系数、零值率与奇偶分布", aria: "分析 JPEG DCT" },
  { key: "frequency", label: "二维 FFT", description: "中心化幅度谱、频带能量与峰值", aria: "执行二维 FFT" },
];

export function StegoParameterPanel({ analysis, disabled, onChange }: StegoParameterPanelProps) {
  const updateOptions = (patch: Partial<StegoOptions>) => onChange({ ...analysis, options: { ...analysis.options, ...patch } });
  return <div className="analysis-inspector-content stego-parameter-panel">
    <div className="inspector-group">
      <span className="inspector-label">分析模块</span>
      {CHECKS.map((item) => <label className="stego-check-row" key={item.key}>
        <input aria-label={item.aria} type="checkbox" checked={analysis.options[item.key]} disabled={disabled} onChange={(event) => updateOptions({ [item.key]: event.target.checked })} />
        <span><strong>{item.label}</strong><small>{item.description}</small></span>
      </label>)}
    </div>
    <div className="inspector-group">
      <span className="inspector-label">扫描限制</span>
      <label className="inline-control stacked"><span>最短字符串</span><input aria-label="最短字符串长度" type="number" min="2" max="128" value={analysis.options.minimumStringLength} disabled={disabled} onChange={(event) => updateOptions({ minimumStringLength: Math.max(2, Math.min(128, Number(event.target.value) || 2)) })} /></label>
      <label className="inline-control stacked"><span>FFT 尺寸</span><select aria-label="FFT 尺寸" value={analysis.options.fftSize} disabled={disabled || !analysis.options.frequency} onChange={(event) => updateOptions({ fftSize: Number(event.target.value) as StegoOptions["fftSize"] })}><option value="128">128 x 128</option><option value="256">256 x 256</option><option value="512">512 x 512</option></select></label>
    </div>
  </div>;
}
