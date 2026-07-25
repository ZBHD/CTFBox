import { Gauge, Play, Square } from "lucide-react";

export type AutomationPhase = "idle" | "running" | "stopped" | "completed" | "flag-found";

interface AutomationControlsProps {
  phase: AutomationPhase;
  concurrency: number;
  active: number;
  started: number;
  onConcurrencyChange: (value: number) => void;
  onStart: () => void;
  onStop: () => void;
}

export function AutomationControls({
  phase,
  concurrency,
  active,
  started,
  onConcurrencyChange,
  onStart,
  onStop,
}: AutomationControlsProps) {
  const running = phase === "running";
  const label = phase === "flag-found" ? "已命中 Flag" : phase === "completed" ? "自动化完成" : phase === "stopped" ? "已停止" : "准备就绪";
  return (
    <section className="automation-controls" aria-label="自动找 Flag">
      <div className="automation-summary">
        <Gauge size={15} />
        <div><strong>自动找 Flag</strong><span>{label} · {active} 个并发任务 · 已启动 {started} 个任务</span></div>
      </div>
      <label className="automation-concurrency">并发
        <input aria-label="自动化并发数" type="number" min="1" max="6" value={concurrency} onChange={(event) => onConcurrencyChange(Math.max(1, Math.min(6, Number(event.target.value) || 1)))} />
      </label>
      {running ? (
        <button type="button" className="secondary-action" onClick={onStop}><Square size={14} />停止自动化</button>
      ) : (
        <button type="button" className="run-action" onClick={onStart}><Play size={14} />开始自动化</button>
      )}
    </section>
  );
}
