export type TaskStatus = "idle" | "running" | "stopped" | "completed" | "failed";

export interface CommandRun {
  id: string;
  argv: string[];
  status: TaskStatus;
  output: string;
  collapsed: boolean;
}

export interface StructuredFinding {
  kind: string;
  value: string;
  [key: string]: unknown;
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
}

export type ToolStreamEvent =
  | { event: "output"; runId: string; stream: "stdout" | "stderr"; chunk: string }
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
  return { ...state, runs, status };
}

export function applyToolStreamEvent(state: TaskState, event: ToolStreamEvent): TaskState {
  if (!state.runs.some((run) => run.id === event.runId)) return state;
  return event.event === "output"
    ? appendOutput(state, event.runId, event.chunk)
    : finishRun(state, event.runId, event.status);
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
