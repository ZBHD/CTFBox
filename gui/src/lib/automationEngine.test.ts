import { describe, expect, it } from "vitest";
import { buildAutomationJobs } from "./automationEngine";

describe("web tool automation planner", () => {
  it("builds SQLmap discovery, table, and dump jobs without waiting for manual suggestions", () => {
    const jobs = buildAutomationJobs("sqlmap", { url: "TARGET_URL" }, [
      { kind: "database", value: "app" },
      { kind: "database", value: "audit" },
      { kind: "table", value: "flags", database: "app" },
    ], ["flag", "CTF"]);

    expect(jobs.map((job) => job.id)).toEqual([
      "sqlmap-detect",
      "sqlmap-tables-app",
      "sqlmap-tables-audit",
      "sqlmap-dump-app-flags",
    ]);
    expect(jobs[0].parameters).toMatchObject({ dbs: true, batch: true, threads: "5" });
    expect(jobs.at(-1)?.parameters).toMatchObject({ database: "app", table: "flags", dump: true, batch: true });
  });

  it("starts SSTImap discovery then schedules bounded read-only flag searches after shell capability is found", () => {
    const jobs = buildAutomationJobs("sstimap", { url: "TARGET_URL" }, [
      { kind: "engine", value: "Jinja2" },
      { kind: "technique", value: "R" },
      { kind: "os", value: "posix-linux" },
      { kind: "capability", value: "Shell command execution" },
    ], ["flag", "CTF"]);

    expect(jobs.map((job) => job.id)).toEqual([
      "sstimap-detect",
      "sstimap-search-content",
      "sstimap-search-files",
      "sstimap-search-common-paths",
    ]);
    expect(jobs.slice(1).every((job) => typeof job.parameters.osCommand === "string")).toBe(true);
    expect(jobs.slice(1).some((job) => String(job.parameters.osCommand).includes("flag\\{"))).toBe(true);
    expect(jobs.slice(1).every((job) => !("upload" in job.parameters) && !("reverseShell" in job.parameters))).toBe(true);
  });
});
