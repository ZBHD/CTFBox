import type { LocalAnalysisState } from "../lib/lsbTypes";

export type TaskStatus = "idle" | "running" | "stopping" | "stopped" | "completed" | "failed";

export interface CommandRun {
  id: string;
  argv: string[];
  status: TaskStatus;
  output: string;
  outputCharsReceived?: number;
  outputTruncated?: boolean;
  collapsed: boolean;
  automationJobId?: string;
  automationLabel?: string;
}

export const MAX_RUN_OUTPUT_CHARS = 1024 * 1024;
export const MAX_TASK_OUTPUT_CHARS = 4 * MAX_RUN_OUTPUT_CHARS;
export const MAX_TASK_RUNS = 256;

export interface StructuredFinding {
  kind: string;
  value: string;
  database?: string;
  table?: string;
  detail?: string;
  runId?: string;
}

export interface TaskSuggestion {
  id: string;
  label: string;
}

export interface TaskState {
  toolId: string;
  edition: "original" | "cn";
  parameters: Record<string, unknown>;
  runs: CommandRun[];
  findings: StructuredFinding[];
  suggestions: TaskSuggestion[];
  status: TaskStatus;
  localAnalysis?: LocalAnalysisState;
}

export type ToolStreamEvent =
  | { event: "output"; runId: string; stream: "stdout" | "stderr"; chunk: string }
  | { event: "analysis"; runId: string; findings: StructuredFinding[] }
  | { event: "exit"; runId: string; status: "completed" | "failed" | "stopped"; code?: number | null };

export function createTask(toolId: string): TaskState {
  return {
    toolId,
    edition: "original",
    parameters: {},
    runs: [],
    findings: [],
    suggestions: [],
    status: "idle",
  };
}

export function appendRun(state: TaskState, run: CommandRun): TaskState {
  return {
    ...state,
    runs: boundRunHistory([
      ...state.runs,
      { ...run, outputCharsReceived: run.outputCharsReceived ?? run.output.length },
    ]),
    status: "running",
  };
}

export function isRunActive(run: CommandRun): boolean {
  return run.status === "running" || run.status === "stopping";
}

function summarizeRuns(runs: CommandRun[]): TaskStatus {
  if (runs.some((run) => run.status === "running")) return "running";
  if (runs.some((run) => run.status === "stopping")) return "stopping";
  if (runs.some((run) => run.status === "failed")) return "failed";
  if (runs.some((run) => run.status === "stopped")) return "stopped";
  return runs.length > 0 ? "completed" : "idle";
}

function boundRunHistory(runs: CommandRun[]) {
  let overflow = runs.length - MAX_TASK_RUNS;
  if (overflow <= 0) return runs;
  return runs.filter((run) => {
    if (overflow <= 0 || isRunActive(run)) return true;
    overflow -= 1;
    return false;
  });
}

export function appendOutput(state: TaskState, runId: string, chunk: string): TaskState {
  let runs = state.runs.map((run) => {
    if (run.id !== runId) return run;
    const combined = run.output + chunk;
    return combined.length > MAX_RUN_OUTPUT_CHARS
      ? {
          ...run,
          output: combined.slice(-MAX_RUN_OUTPUT_CHARS),
          outputCharsReceived: (run.outputCharsReceived ?? run.output.length) + chunk.length,
          outputTruncated: true,
        }
      : {
          ...run,
          output: combined,
          outputCharsReceived: (run.outputCharsReceived ?? run.output.length) + chunk.length,
        };
  });
  let overflow = runs.reduce((total, run) => total + run.output.length, 0) - MAX_TASK_OUTPUT_CHARS;
  if (overflow > 0) {
    runs = runs.map((run) => {
      if (overflow <= 0 || run.output.length === 0) return run;
      const removed = Math.min(overflow, run.output.length);
      overflow -= removed;
      return { ...run, output: run.output.slice(removed), outputTruncated: true };
    });
  }
  return {
    ...state,
    runs,
  };
}

export function finishRun(state: TaskState, runId: string, status: "completed" | "failed" | "stopped"): TaskState {
  const runs = boundRunHistory(state.runs.map((run) => run.id === runId ? { ...run, status } : run));
  return { ...state, runs, status: summarizeRuns(runs) };
}

export function requestRunStop(state: TaskState, runId: string): TaskState {
  const runs = state.runs.map((run) => run.id === runId && run.status === "running"
    ? { ...run, status: "stopping" as const }
    : run);
  return { ...state, runs, status: summarizeRuns(runs) };
}

export function restoreRunRunning(state: TaskState, runId: string): TaskState {
  const runs = state.runs.map((run) => run.id === runId && run.status === "stopping"
    ? { ...run, status: "running" as const }
    : run);
  return { ...state, runs, status: summarizeRuns(runs) };
}

function findingKey(finding: StructuredFinding) {
  return JSON.stringify([
    finding.kind,
    finding.value,
    finding.database ?? null,
    finding.table ?? null,
    finding.detail ?? null,
  ]);
}

export function appendFindings(
  state: TaskState,
  runId: string,
  findings: StructuredFinding[],
): TaskState {
  const keys = new Set(state.findings.map(findingKey));
  const additions: StructuredFinding[] = [];
  for (const finding of findings) {
    const key = findingKey(finding);
    if (keys.has(key)) continue;
    keys.add(key);
    additions.push({ ...finding, runId });
  }
  return additions.length > 0
    ? { ...state, findings: [...state.findings, ...additions] }
    : state;
}

export function applyToolStreamEvent(state: TaskState, event: ToolStreamEvent): TaskState {
  if (!state.runs.some((run) => run.id === event.runId)) return state;
  switch (event.event) {
    case "output":
      return appendOutput(state, event.runId, event.chunk);
    case "analysis":
      return appendFindings(state, event.runId, event.findings);
    case "exit":
      return finishRun(state, event.runId, event.status);
  }
}

export function updateTaskContainingRun(
  tasks: Record<string, TaskState>,
  runId: string,
  updater: (task: TaskState) => TaskState,
): Record<string, TaskState> {
  const entry = Object.entries(tasks).find(([, task]) => task.runs.some((run) => run.id === runId));
  if (!entry) return tasks;
  const [key, task] = entry;
  return { ...tasks, [key]: updater(task) };
}

export function clearTask(state: TaskState): TaskState {
  return createTask(state.toolId);
}
