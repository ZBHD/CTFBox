import { describe, expect, it } from "vitest";
import {
  appendOutput,
  appendRun,
  clearTask,
  finishRun,
  createTask,
  applyToolStreamEvent,
  updateTaskContainingRun,
  MAX_RUN_OUTPUT_CHARS,
  MAX_TASK_OUTPUT_CHARS,
  MAX_TASK_RUNS,
  type CommandRun,
  type TaskState,
  type ToolStreamEvent,
} from "./taskStore";

const run: CommandRun = {
  id: "run-1",
  argv: ["sqlmap.py", "--help"],
  status: "running",
  output: "",
  collapsed: false,
};

describe("in-memory task state", () => {
  it("appends a second command without replacing the first output", () => {
    const first = appendOutput(appendRun(createTask("sqlmap"), run), "run-1", "first\n");
    const second = appendRun(first, { ...run, id: "run-2" });

    expect(second.runs.map((item) => item.id)).toEqual(["run-1", "run-2"]);
    expect(second.runs[0].output).toBe("first\n");
  });

  it("bounds individual and aggregate output while preserving truncation state", () => {
    const oversized = "x".repeat(MAX_RUN_OUTPUT_CHARS + 100);
    const first = appendOutput(appendRun(createTask("sqlmap"), run), run.id, oversized);

    expect(first.runs[0].output.length).toBeLessThanOrEqual(MAX_RUN_OUTPUT_CHARS);
    expect(first.runs[0].outputTruncated).toBe(true);

    let task = first;
    for (let index = 2; index <= 8; index += 1) {
      const id = `run-${index}`;
      task = appendRun(task, { ...run, id });
      task = appendOutput(task, id, "y".repeat(MAX_RUN_OUTPUT_CHARS));
    }
    expect(task.runs.reduce((total, item) => total + item.output.length, 0)).toBeLessThanOrEqual(MAX_TASK_OUTPUT_CHARS);
    expect(task.runs.slice(0, -1).some((item) => item.outputTruncated)).toBe(true);
  });

  it("tracks total received output after the retained buffer is truncated", () => {
    const task = appendOutput(
      appendRun(createTask("sqlmap"), { ...run, output: "started\n" }),
      run.id,
      "x".repeat(MAX_RUN_OUTPUT_CHARS + 10),
    );

    expect(task.runs[0].output).toHaveLength(MAX_RUN_OUTPUT_CHARS);
    expect(task.runs[0].outputCharsReceived).toBe("started\n".length + MAX_RUN_OUTPUT_CHARS + 10);
  });

  it("bounds completed command history while retaining active runs", () => {
    let task = createTask("sqlmap");
    for (let index = 0; index < MAX_TASK_RUNS + 20; index += 1) {
      const id = `history-${index}`;
      task = finishRun(appendRun(task, { ...run, id }), id, "completed");
    }
    task = appendRun(task, { ...run, id: "active-run" });

    expect(task.runs).toHaveLength(MAX_TASK_RUNS);
    expect(task.runs[0].id).toBe("history-21");
    expect(task.runs.at(-1)?.id).toBe("active-run");
  });

  it("clears parameters, runs, findings, and suggestions", () => {
    const task = appendRun(createTask("sqlmap"), run);
    const populated = {
      ...task,
      parameters: { url: "http://127.0.0.1" },
      findings: [{ kind: "database", value: "main" }],
      suggestions: [{ id: "tables", label: "枚举表" }],
    };

    expect(clearTask(populated)).toEqual(createTask("sqlmap"));
  });

  it("clears structured local analysis state", () => {
    const populated: TaskState = {
      ...createTask("misc"),
      localAnalysis: {
        kind: "lsb",
        status: "completed",
        mode: "auto",
        depth: "quick",
        parameters: {
          sourceKind: "rgba",
          sources: [{ channel: "R", bit: 0 }],
          scan: {
            major: "row",
            x: "left-to-right",
            y: "top-to-bottom",
            serpentine: false,
            reversePixels: false,
          },
          layout: "pixel-interleaved",
          packing: "msb-first",
          bitOffset: 0,
          invertBits: false,
          reverseBytes: false,
          byteOffset: 0,
        },
        candidates: [],
      },
    };

    expect(clearTask(populated)).toEqual(createTask("misc"));
  });

  it("finishes a process run and updates the task status", () => {
    const task = appendRun(createTask("sqlmap"), run);
    expect(finishRun(task, "run-1", "completed").runs[0].status).toBe("completed");
    expect(finishRun(task, "run-1", "failed").status).toBe("failed");
  });

  it("keeps the task running until every concurrent process has exited", () => {
    const task = appendRun(appendRun(createTask("sqlmap"), run), { ...run, id: "run-2" });

    const afterFirstExit = finishRun(task, "run-1", "completed");

    expect(afterFirstExit.status).toBe("running");
    expect(finishRun(afterFirstExit, "run-2", "completed").status).toBe("completed");
  });

  it("keeps a failed concurrent run visible after another run completes", () => {
    const task = appendRun(appendRun(createTask("sqlmap"), run), { ...run, id: "run-2" });

    const afterFailure = finishRun(task, "run-1", "failed");

    expect(afterFailure.status).toBe("running");
    expect(finishRun(afterFailure, "run-2", "completed").status).toBe("failed");
  });

  it("applies output and exit messages from the tool channel", () => {
    const task = appendRun(createTask("sqlmap"), run);
    const withOutput = applyToolStreamEvent(task, {
      event: "output",
      runId: "run-1",
      stream: "stdout",
      chunk: "sqlmap output\n",
    });
    const completed = applyToolStreamEvent(withOutput, {
      event: "exit",
      runId: "run-1",
      status: "completed",
      code: 0,
    });

    expect(completed.runs[0].output).toBe("sqlmap output\n");
    expect(completed.runs[0].status).toBe("completed");
    expect(completed.status).toBe("completed");
  });

  it("merges contextual analysis findings into the owning run only", () => {
    const task = appendRun(createTask("sqlmap"), run);
    const event: ToolStreamEvent = {
      event: "analysis",
      runId: "run-1",
      findings: [
        { kind: "table", value: "users", database: "app" },
        { kind: "table", value: "users", database: "audit" },
        { kind: "table", value: "users", database: "app" },
      ],
    };

    const next = applyToolStreamEvent(task, event);

    expect(next.findings).toEqual([
      { kind: "table", value: "users", database: "app", runId: "run-1" },
      { kind: "table", value: "users", database: "audit", runId: "run-1" },
    ]);
    expect(next.runs[0].output).toBe("");
  });

  it("updates only the task that owns a run id", () => {
    const sqlmap = appendRun(createTask("sqlmap"), run);
    const sstimap = createTask("sstimap");
    const tasks = updateTaskContainingRun(
      { sqlmap, sstimap },
      "run-1",
      (task) => appendOutput(task, "run-1", "failed\n"),
    );

    expect(tasks.sqlmap.runs[0].output).toBe("failed\n");
    expect(tasks.sstimap).toBe(sstimap);
  });
});
