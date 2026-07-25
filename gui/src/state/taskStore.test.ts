import { describe, expect, it } from "vitest";
import {
  appendOutput,
  appendRun,
  clearTask,
  finishRun,
  createTask,
  applyToolStreamEvent,
  updateTaskContainingRun,
  type CommandRun,
  type TaskState,
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
