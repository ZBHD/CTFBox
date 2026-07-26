import { Gauge, Play, Square } from "lucide-react";

export type AutomationPhase = "idle" | "running" | "stopped" | "completed" | "failed" | "flag-found";

interface AutomationControlsProps {
  toolId: string;
  phase: AutomationPhase;
  concurrency: number;
  timeoutSeconds: number;
  maxSqlmapDumps: number;
  databaseScope?: string;
  active: number;
  started: number;
  onConcurrencyChange: (value: number) => void;
  onTimeoutChange: (value: number) => void;
  onMaxSqlmapDumpsChange: (value: number) => void;
  onStart: () => void;
  onStop: () => void;
}

export function AutomationControls({
  toolId,
  phase,
  concurrency,
  timeoutSeconds,
  maxSqlmapDumps,
  databaseScope,
  active,
  started,
  onConcurrencyChange,
  onTimeoutChange,
  onMaxSqlmapDumpsChange,
  onStart,
  onStop,
}: AutomationControlsProps) {
  const running = phase === "running";
  const label = phase === "flag-found" ? "已命中 Flag" : phase === "completed" ? "队列已结束" : phase === "failed" ? "自动化失败" : phase === "stopped" ? "已停止" : "准备就绪";
  return (
    <section className="automation-controls" aria-label="自动找 Flag">
      <div className="automation-summary">
        <Gauge size={15} />
        <div><strong>自动找 Flag</strong><span>{label} · {active} 个并发任务 · 已启动 {started} 个任务</span></div>
      </div>
      <label className="automation-concurrency">并发
        <input aria-label="自动化并发数" type="number" min="1" max="6" value={concurrency} onChange={(event) => onConcurrencyChange(Math.max(1, Math.min(6, Number(event.target.value) || 1)))} />
      </label>
      <label className="automation-concurrency">时限
        <input aria-label="单任务时限（秒）" type="number" min="30" max="1800" value={timeoutSeconds} onChange={(event) => onTimeoutChange(Math.max(30, Math.min(1800, Number(event.target.value) || 30)))} />
      </label>
      {toolId === "sqlmap" && <>
        <label className="automation-concurrency">导出上限
          <input aria-label="SQLmap 自动导出表数" type="number" min="1" max="50" value={maxSqlmapDumps} onChange={(event) => onMaxSqlmapDumpsChange(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} />
        </label>
        <span className="automation-scope" title="在任务参数的数据库字段中选择范围">{databaseScope ? `数据库：${databaseScope}` : "数据库：全部发现结果"}</span>
      </>}
      {running ? (
        <button type="button" className="secondary-action" onClick={onStop}><Square size={14} />停止自动化</button>
      ) : (
        <button type="button" className="run-action" onClick={onStart}><Play size={14} />开始自动化</button>
      )}
    </section>
  );
}
