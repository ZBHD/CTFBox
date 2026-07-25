import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { LsbBit, LsbChannel, LsbLocalAnalysis } from "../../../lib/lsbTypes";

interface LsbParameterPanelProps {
  analysis: LsbLocalAnalysis;
  disabled: boolean;
  onChange: (analysis: LsbLocalAnalysis) => void;
}

function Segment({ value, options, disabled, onChange }: { value: string; options: Array<{ value: string; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="local-segmented">{options.map((option) => <button type="button" key={option.value} className={value === option.value ? "active" : ""} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

export function LsbParameterPanel({ analysis, disabled, onChange }: LsbParameterPanelProps) {
  const [newChannel, setNewChannel] = useState<LsbChannel>("R");
  const [newBit, setNewBit] = useState<LsbBit>(0);
  const updateParameters = (patch: Partial<LsbLocalAnalysis["parameters"]>) => onChange({
    ...analysis,
    parameters: { ...analysis.parameters, ...patch },
  });
  const updateScan = (patch: Partial<LsbLocalAnalysis["parameters"]["scan"]>) => updateParameters({
    scan: { ...analysis.parameters.scan, ...patch },
  });
  const moveToken = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= analysis.parameters.sources.length) return;
    const sources = analysis.parameters.sources.map((item) => ({ ...item }));
    [sources[index], sources[target]] = [sources[target], sources[index]];
    updateParameters({ sources });
  };

  return <div className="analysis-inspector-content lsb-parameter-panel">
    <div className="inspector-group">
      <span className="inspector-label">工作模式</span>
      <Segment value={analysis.mode} disabled={disabled} options={[{ value: "auto", label: "自动分析" }, { value: "manual", label: "手动提取" }]} onChange={(mode) => onChange({ ...analysis, mode: mode as LsbLocalAnalysis["mode"] })} />
    </div>

    <div className="lsb-mode-section" hidden={analysis.mode !== "auto"}>
      <div className="inspector-group">
        <span className="inspector-label">搜索深度</span>
        <Segment value={analysis.depth} disabled={disabled} options={[{ value: "quick", label: "快速扫描" }, { value: "deep", label: "深度扫描" }]} onChange={(depth) => onChange({ ...analysis, depth: depth as LsbLocalAnalysis["depth"] })} />
        <small className="control-help">深度扫描额外检查多通道混合位组合</small>
      </div>
    </div>

    <div className="lsb-mode-section" hidden={analysis.mode !== "manual"}>
      <div className="inspector-group">
        <span className="inspector-label">像素数据源</span>
        <Segment value={analysis.parameters.sourceKind} disabled={disabled || !analysis.source?.paletteIndices} options={[{ value: "rgba", label: "RGBA 像素" }, { value: "palette-index", label: "PNG 索引" }]} onChange={(sourceKind) => updateParameters({ sourceKind: sourceKind as LsbLocalAnalysis["parameters"]["sourceKind"], sources: sourceKind === "palette-index" ? [{ channel: "I", bit: 0 }] : [{ channel: "R", bit: 0 }, { channel: "G", bit: 0 }, { channel: "B", bit: 0 }] })} />
      </div>

      <div className="inspector-group">
        <span className="inspector-label">数据源顺序</span>
        <div className="lsb-token-list">{analysis.parameters.sources.map((source, index) => <div className="lsb-token" key={`${source.channel}-${source.bit}-${index}`}>
          <span className="lsb-token-label">{source.channel}{source.bit}</span>
          <button type="button" title="左移数据源" disabled={disabled || index === 0} onClick={() => moveToken(index, -1)}><ArrowLeft size={12} /></button>
          <button type="button" title="右移数据源" disabled={disabled || index === analysis.parameters.sources.length - 1} onClick={() => moveToken(index, 1)}><ArrowRight size={12} /></button>
          <button type="button" title="删除数据源" disabled={disabled || analysis.parameters.sources.length === 1} onClick={() => updateParameters({ sources: analysis.parameters.sources.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={12} /></button>
        </div>)}</div>
        <div className="lsb-token-adder">
          <select aria-label="新数据源通道" value={newChannel} disabled={disabled} onChange={(event) => setNewChannel(event.target.value as LsbChannel)}>
            {(analysis.parameters.sourceKind === "palette-index" ? ["I"] : ["R", "G", "B", "A"]).map((channel) => <option key={channel}>{channel}</option>)}
          </select>
          <select aria-label="新数据源位" value={newBit} disabled={disabled} onChange={(event) => setNewBit(Number(event.target.value) as LsbBit)}>
            {Array.from({ length: 8 }, (_, bit) => <option key={bit} value={bit}>{bit}</option>)}
          </select>
          <button type="button" className="icon-action" title="添加数据源" disabled={disabled} onClick={() => updateParameters({ sources: [...analysis.parameters.sources, { channel: newChannel, bit: newBit }] })}><Plus size={14} /></button>
        </div>
      </div>

      <div className="inspector-group">
        <span className="inspector-label">扫描路径</span>
        <Segment value={analysis.parameters.scan.major} disabled={disabled} options={[{ value: "row", label: "逐行" }, { value: "column", label: "逐列" }]} onChange={(major) => updateScan({ major: major as "row" | "column" })} />
        <Segment value={analysis.parameters.scan.x} disabled={disabled} options={[{ value: "left-to-right", label: "左 → 右" }, { value: "right-to-left", label: "右 → 左" }]} onChange={(x) => updateScan({ x: x as LsbLocalAnalysis["parameters"]["scan"]["x"] })} />
        <Segment value={analysis.parameters.scan.y} disabled={disabled} options={[{ value: "top-to-bottom", label: "上 → 下" }, { value: "bottom-to-top", label: "下 → 上" }]} onChange={(y) => updateScan({ y: y as LsbLocalAnalysis["parameters"]["scan"]["y"] })} />
        <label className="lsb-check"><input type="checkbox" checked={analysis.parameters.scan.serpentine} disabled={disabled} onChange={(event) => updateScan({ serpentine: event.target.checked })} />蛇形扫描</label>
        <label className="lsb-check"><input type="checkbox" checked={analysis.parameters.scan.reversePixels} disabled={disabled} onChange={(event) => updateScan({ reversePixels: event.target.checked })} />反转像素序列</label>
      </div>

      <div className="inspector-group">
        <span className="inspector-label">位流与字节</span>
        <Segment value={analysis.parameters.layout} disabled={disabled} options={[{ value: "pixel-interleaved", label: "像素交错" }, { value: "channel-block", label: "通道分块" }]} onChange={(layout) => updateParameters({ layout: layout as LsbLocalAnalysis["parameters"]["layout"] })} />
        <Segment value={analysis.parameters.packing} disabled={disabled} options={[{ value: "msb-first", label: "MSB 优先" }, { value: "lsb-first", label: "LSB 优先" }]} onChange={(packing) => updateParameters({ packing: packing as LsbLocalAnalysis["parameters"]["packing"] })} />
        <label className="inline-control stacked"><span>位偏移</span><input type="number" min="0" max="7" value={analysis.parameters.bitOffset} disabled={disabled} onChange={(event) => updateParameters({ bitOffset: Math.max(0, Math.min(7, Number(event.target.value))) as LsbBit })} /></label>
        <label className="inline-control stacked"><span>字节偏移</span><input type="number" min="0" value={analysis.parameters.byteOffset} disabled={disabled} onChange={(event) => updateParameters({ byteOffset: Math.max(0, Number(event.target.value)) })} /></label>
        <label className="inline-control stacked"><span>输出上限（字节）</span><input type="number" min="1" value={analysis.parameters.byteLimit ?? ""} placeholder="默认 134217728" disabled={disabled} onChange={(event) => updateParameters({ byteLimit: event.target.value ? Math.max(1, Number(event.target.value)) : undefined })} /></label>
        <label className="inline-control stacked"><span>结束标记</span><input value={analysis.parameters.terminator ?? ""} placeholder="可选，例如 }" disabled={disabled} onChange={(event) => updateParameters({ terminator: event.target.value || undefined })} /></label>
        <label className="lsb-check"><input type="checkbox" checked={analysis.parameters.invertBits} disabled={disabled} onChange={(event) => updateParameters({ invertBits: event.target.checked })} />反转位值</label>
        <label className="lsb-check"><input type="checkbox" checked={analysis.parameters.reverseBytes} disabled={disabled} onChange={(event) => updateParameters({ reverseBytes: event.target.checked })} />反转字节序列</label>
      </div>
    </div>
  </div>;
}
