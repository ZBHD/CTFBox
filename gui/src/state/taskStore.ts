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

export function clearTask(state: TaskState): TaskState {
  return createTask(state.toolId);
}
