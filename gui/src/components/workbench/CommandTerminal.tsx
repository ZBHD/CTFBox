import { ChevronDown, ChevronRight, TerminalSquare } from "lucide-react";
import type { CommandRun } from "../../state/taskStore";

interface CommandTerminalProps {
  runs: CommandRun[];
  commandPreview: string;
  onToggleRun?: (runId: string) => void;
}

const STATUS_LABEL: Record<CommandRun["status"], string> = {
  idle: "等待",
  running: "运行中",
  stopped: "已停止",
  completed: "已完成",
  failed: "失败",
};

export function CommandTerminal({
  runs,
  commandPreview,
  onToggleRun,
}: CommandTerminalProps) {
  return (
    <section className="terminal-panel" aria-label="命令终端">
      <header className="panel-header terminal-header">
        <div className="panel-title">
          <TerminalSquare size={15} />
          <h2>命令终端</h2>
        </div>
        <span className="terminal-count">{runs.length} 次运行</span>
      </header>

      <div className="terminal-scroll" aria-live="polite">
        {runs.length === 0 ? (
          <div className="terminal-empty">
            <span className="terminal-prompt">$</span>
            <span>命令将在这里持续显示</span>
          </div>
        ) : (
          runs.map((run) => (
            <article className="terminal-run" id={run.id} key={run.id}>
              <button
                className="terminal-run-heading"
                type="button"
                aria-expanded={!run.collapsed}
                onClick={() => onToggleRun?.(run.id)}
              >
                {run.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <code>$ {run.argv.join(" ")}</code>
                <span className={`run-status run-status-${run.status}`}>
                  {STATUS_LABEL[run.status]}
                </span>
              </button>
              {!run.collapsed && <pre>{run.output || "等待回显..."}</pre>}
              {run.collapsed && <span className="terminal-output-cache">{run.output}</span>}
            </article>
          ))
        )}
      </div>

      <div className="command-preview">
        <span>$</span>
        <code>{commandPreview || "等待配置参数..."}</code>
      </div>
    </section>
  );
}
