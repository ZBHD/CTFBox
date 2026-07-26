import { describe, expect, it } from "vitest";
import { appendOutput, appendRun, createTask, MAX_RUN_OUTPUT_CHARS } from "../state/taskStore";
import { detectFlags } from "./flagDetector";
import { DEFAULT_FLAG_SETTINGS } from "./flagSettingsPreference";
import { MAX_FLAG_SCAN_TAIL_CHARS, MAX_TASK_FLAG_HITS, TaskFlagScanner } from "./taskFlagScanner";

describe("incremental task Flag scanner", () => {
  it("scans only the appended output after the retained run buffer rolls over", () => {
    const scannedLengths: number[] = [];
    const scanner = new TaskFlagScanner((text, prefixes, caseSensitive) => {
      scannedLengths.push(text.length);
      return detectFlags(text, prefixes, caseSensitive);
    });
    let task = appendRun(createTask("sqlmap"), {
      id: "run-1",
      argv: ["sqlmap.py"],
      status: "running",
      output: "",
      collapsed: false,
    });
    task = appendOutput(task, "run-1", `${"x".repeat(MAX_RUN_OUTPUT_CHARS - 4)}flag`);

    expect(scanner.scan("sqlmap:default", task, DEFAULT_FLAG_SETTINGS, ["flag"])).toEqual([]);

    task = appendOutput(task, "run-1", "{split_across_chunks}");
    const hits = scanner.scan("sqlmap:default", task, DEFAULT_FLAG_SETTINGS, ["flag"]);

    expect(hits).toContainEqual({ text: "flag{split_across_chunks}", source: "plain" });
    expect(scannedLengths.at(-1)).toBeLessThanOrEqual(MAX_FLAG_SCAN_TAIL_CHARS + 32);
  });

  it("invalidates cached results when detection settings change or the task is cleared", () => {
    const scanner = new TaskFlagScanner();
    let task = appendRun(createTask("sqlmap"), {
      id: "run-1",
      argv: ["sqlmap.py"],
      status: "completed",
      output: "CTF{visible}",
      collapsed: false,
    });

    expect(scanner.scan("sqlmap:default", task, DEFAULT_FLAG_SETTINGS, ["CTF"])).toHaveLength(1);
    expect(scanner.scan("sqlmap:default", task, { ...DEFAULT_FLAG_SETTINGS, scanOutput: false }, ["CTF"])).toEqual([]);

    task = createTask("sqlmap");
    expect(scanner.scan("sqlmap:default", task, DEFAULT_FLAG_SETTINGS, ["CTF"])).toEqual([]);
  });

  it("does not scan task content while Flag detection is disabled", () => {
    let calls = 0;
    const scanner = new TaskFlagScanner(() => {
      calls += 1;
      return [];
    });
    const task = appendRun(createTask("sqlmap"), {
      id: "run-1",
      argv: ["sqlmap.py"],
      status: "completed",
      output: "flag{disabled}",
      collapsed: false,
    });

    expect(scanner.scan("sqlmap:default", task, { ...DEFAULT_FLAG_SETTINGS, enabled: false }, ["flag"])).toEqual([]);
    expect(calls).toBe(0);
  });

  it("bounds cached unique hits for a long-running task", () => {
    let detected = 0;
    const scanner = new TaskFlagScanner(() => [{ text: `flag{${detected += 1}}`, source: "plain" }]);
    let task = appendRun(createTask("sqlmap"), {
      id: "run-1",
      argv: ["sqlmap.py"],
      status: "running",
      output: "",
      collapsed: false,
    });

    for (let index = 0; index < MAX_TASK_FLAG_HITS + 20; index += 1) {
      task = appendOutput(task, "run-1", "x");
      scanner.scan("sqlmap:default", task, DEFAULT_FLAG_SETTINGS, ["flag"]);
    }

    const hits = scanner.scan("sqlmap:default", task, DEFAULT_FLAG_SETTINGS, ["flag"]);
    expect(hits).toHaveLength(MAX_TASK_FLAG_HITS);
    expect(hits.at(-1)?.text).toBe(`flag{${detected}}`);
  });
});
