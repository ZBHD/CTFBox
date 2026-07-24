import { Play, RotateCcw, Square } from "lucide-react";
import type { PluginEdition, ToolPlugin } from "../../lib/pluginRegistry";

interface ModeControlsProps {
  plugin: ToolPlugin;
  modeLabel?: string;
  edition: PluginEdition;
  running: boolean;
  canRun: boolean;
  executionControls?: boolean;
  onEditionChange: (edition: PluginEdition) => void;
  onRun: () => void;
  onClear: () => void;
}

export function ModeControls({
  plugin,
  modeLabel,
  edition,
  running,
  canRun,
  executionControls = true,
  onEditionChange,
  onRun,
  onClear,
}: ModeControlsProps) {
  return (
    <header className="workspace-header">
      <div className="workspace-identity">
        <span className="workspace-kicker">当前工具</span>
        <div><h1>{plugin.name}</h1>{modeLabel && <span>{modeLabel}</span>}</div>
        <p>{plugin.description}</p>
      </div>
      {executionControls && <div className="workspace-actions">
        {plugin.editions && (
          <div className="edition-switch" aria-label="版本选择">
            <button className={edition === "original" ? "active" : ""} type="button" onClick={() => onEditionChange("original")}>原版</button>
            <button className={edition === "cn" ? "active" : ""} type="button" onClick={() => onEditionChange("cn")}>汉化版</button>
          </div>
        )}
        <button className="secondary-action" type="button" onClick={onClear} title="清空当前任务">
          <RotateCcw size={15} />清空
        </button>
        <button className="run-action" type="button" disabled={!canRun} onClick={onRun}>
          {running ? <Square size={15} /> : <Play size={15} />}
          {running ? "停止" : "运行"}
        </button>
      </div>}
    </header>
  );
}
