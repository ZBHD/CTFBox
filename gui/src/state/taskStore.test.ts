import { describe, expect, it } from "vitest";
import {
  appendOutput,
  appendRun,
  clearTask,
  createTask,
  type CommandRun,
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
});
