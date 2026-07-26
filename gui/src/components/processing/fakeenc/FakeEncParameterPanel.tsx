import type { ZipLocalAnalysis } from "../../../lib/zipTypes";

interface FakeEncParameterPanelProps {
  analysis: ZipLocalAnalysis;
  disabled: boolean;
  onChange: (analysis: ZipLocalAnalysis) => void;
}

function OptionRow({ title, description, active, ariaLabel, disabled, onToggle }: { title: string; description: string; active: boolean; ariaLabel: string; disabled: boolean; onToggle: (next: boolean) => void }) {
  return <label className={active ? "inspection-row active" : "inspection-row"}>
    <input type="checkbox" className="visually-hidden" aria-label={ariaLabel} checked={active} disabled={disabled} onChange={(event) => onToggle(event.target.checked)} />
    <span className="inspection-check" /><span><strong>{title}</strong><small>{description}</small></span>
  </label>;
}

export function FakeEncParameterPanel({ analysis, disabled, onChange }: FakeEncParameterPanelProps) {
  const { options } = analysis;
  const patch = (next: Partial<ZipLocalAnalysis["options"]>) => onChange({ ...analysis, options: { ...options, ...next } });
  return <div className="analysis-inspector-content fakeenc-parameter-panel">
    <div className="inspector-group">
      <span className="inspector-label">ZIP 加密标记</span>
      <OptionRow title="本地文件头" description="检查 General Purpose Bit Flag 第 0 位" ariaLabel="检查本地文件头" disabled={disabled} active={options.checkLocalHeader} onToggle={(checkLocalHeader) => patch({ checkLocalHeader })} />
      <OptionRow title="中央目录" description="同步检查 Central Directory 标记" ariaLabel="检查中央目录" disabled={disabled} active={options.checkCentralDirectory} onToggle={(checkCentralDirectory) => patch({ checkCentralDirectory })} />
    </div>
    <div className="inspector-group">
      <span className="inspector-label">修复策略</span>
      <button type="button" className={options.repairMode !== "report" ? "analysis-option active" : "analysis-option"} disabled={disabled} onClick={() => patch({ repairMode: "repair" })}>清除错误标记</button>
      <button type="button" className={options.repairMode === "report" ? "analysis-option active" : "analysis-option"} disabled={disabled} onClick={() => patch({ repairMode: "report" })}>仅生成报告</button>
    </div>
  </div>;
}
