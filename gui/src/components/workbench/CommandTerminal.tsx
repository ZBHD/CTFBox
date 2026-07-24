import { ChevronDown, ChevronRight, SendHorizontal, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { FlagHit } from "../../lib/flagDetector";
import type { CommandRun } from "../../state/taskStore";

interface CommandTerminalProps {
  runs: CommandRun[];
  commandPreview: string;
  onToggleRun?: (runId: string) => void;
  flagHits?: FlagHit[];
  runningRunId?: string;
  onSendInput?: (input: string) => void;
}

const STATUS_LABEL: Record<CommandRun["status"], string> = {
  idle: "等待",
  running: "运行中",
  stopped: "已停止",
  completed: "已完成",
  failed: "失败",
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightOutput(output: string, hits: FlagHit[]) {
  const tokens = Array.from(new Set(hits.map((hit) => hit.encoded ?? hit.text))).filter(Boolean);
  if (tokens.length === 0) return output;
  const tokenSet = new Set(tokens);
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
  return output.split(pattern).map((part, index) => tokenSet.has(part) ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export function CommandTerminal({
  runs,
  commandPreview,
  onToggleRun,
  flagHits = [],
  runningRunId,
  onSendInput,
}: CommandTerminalProps) {
  const [input, setInput] = useState("");
  const submitInput = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim()) return;
    onSendInput?.(input);
    setInput("");
  };
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
              {!run.collapsed && <pre>{run.output ? highlightOutput(run.output, flagHits) : "等待回显..."}</pre>}
              {run.collapsed && <span className="terminal-output-cache">{run.output}</span>}
            </article>
          ))
        )}
      </div>

      {runningRunId && onSendInput && <form className="terminal-input" onSubmit={submitInput}>
        <input aria-label="向工具发送输入" value={input} onChange={(event) => setInput(event.target.value)} placeholder="需要交互时输入内容" />
        <button type="submit" title="发送输入"><SendHorizontal size={14} />发送输入</button>
      </form>}

      <div className="command-preview">
        <span>$</span>
        <code>{commandPreview || "等待配置参数..."}</code>
      </div>
    </section>
  );
}
