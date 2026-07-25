import type { LocalAnalysisState } from "../lib/lsbTypes";

export type TaskStatus = "idle" | "running" | "stopped" | "completed" | "failed";

export interface CommandRun {
  id: string;
  argv: string[];
  status: TaskStatus;
  output: string;
  collapsed: boolean;
  automationJobId?: string;
  automationLabel?: string;
}

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
  return { ...state, runs: [...state.runs, { ...run }], status: "running" };
}

export function appendOutput(state: TaskState, runId: string, chunk: string): TaskState {
  return {
    ...state,
    runs: state.runs.map((run) =>
      run.id === runId ? { ...run, output: run.output + chunk } : run,
    ),
  };
}

export function finishRun(state: TaskState, runId: string, status: "completed" | "failed" | "stopped"): TaskState {
  const runs = state.runs.map((run) => run.id === runId ? { ...run, status } : run);
  const taskStatus = runs.some((run) => run.status === "running")
    ? "running"
    : runs.some((run) => run.status === "failed")
      ? "failed"
      : runs.some((run) => run.status === "stopped")
        ? "stopped"
        : "completed";
  return { ...state, runs, status: taskStatus };
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
