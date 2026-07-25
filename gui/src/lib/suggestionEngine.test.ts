import { describe, expect, it } from "vitest";
import type { StructuredFinding } from "../state/taskStore";
import {
  applySuggestionPatch,
  buildTaskSuggestions,
} from "./suggestionEngine";

const base = {
  url: "TARGET_URL",
  cookie: "session=abc",
  proxy: "http://127.0.0.1:8080",
  tamper: "between",
  batch: true,
};

describe("task suggestion engine", () => {
  it("suggests database enumeration after SQL injection is identified", () => {
    expect(buildTaskSuggestions("sqlmap", base, [
      { kind: "injection-point", value: "id" },
    ])).toEqual([
      {
        id: "sqlmap-enumerate-databases",
        label: "枚举可用数据库",
        patch: { dbs: true },
      },
    ]);
  });

  it("skips unsupported database enumeration for SQLite", () => {
    expect(buildTaskSuggestions("sqlmap", base, [
      { kind: "injection-point", value: "id" },
      { kind: "dbms", value: "SQLite" },
    ])).toEqual([
      {
        id: "sqlmap-enumerate-tables-sqlite",
        label: "枚举 SQLite 数据表",
        patch: { tables: true },
      },
    ]);
  });

  it("uses a single database candidate for the table step", () => {
    expect(buildTaskSuggestions("sqlmap", base, [
      { kind: "database", value: "app" },
    ])[0]).toEqual({
      id: "sqlmap-enumerate-tables-app",
      label: "枚举 app 的数据表",
      patch: { database: "app", tables: true },
    });
  });

  it("does not choose among multiple databases", () => {
    const findings: StructuredFinding[] = [
      { kind: "database", value: "app" },
      { kind: "database", value: "audit" },
    ];

    expect(buildTaskSuggestions("sqlmap", base, findings)).toEqual([]);
  });

  it("respects an explicit database and filters its table candidates", () => {
    const findings: StructuredFinding[] = [
      { kind: "database", value: "app" },
      { kind: "database", value: "audit" },
      { kind: "table", value: "users", database: "app" },
      { kind: "table", value: "events", database: "audit" },
    ];

    expect(buildTaskSuggestions("sqlmap", { ...base, database: "app" }, findings)[0]).toEqual({
      id: "sqlmap-enumerate-columns-app-users",
      label: "枚举 app.users 的字段",
      patch: { database: "app", table: "users", columns: true },
    });
  });

  it("requires a table choice when one database has multiple tables", () => {
    const findings: StructuredFinding[] = [
      { kind: "database", value: "app" },
      { kind: "table", value: "users", database: "app" },
      { kind: "table", value: "orders", database: "app" },
    ];

    expect(buildTaskSuggestions("sqlmap", base, findings)).toEqual([]);
  });

  it("uses the selected table and one contextual column for export", () => {
    const findings: StructuredFinding[] = [
      { kind: "database", value: "app" },
      { kind: "table", value: "users", database: "app" },
      { kind: "column", value: "name", database: "app", table: "users" },
      { kind: "column", value: "message", database: "app", table: "logs" },
    ];

    expect(buildTaskSuggestions(
      "sqlmap",
      { ...base, database: "app", table: "users" },
      findings,
    )[0]).toEqual({
      id: "sqlmap-dump-app-users-name",
      label: "导出 app.users.name",
      patch: { database: "app", table: "users", column: "name", dump: true },
    });
  });

  it("clears mutually exclusive SQLmap actions and preserves request parameters", () => {
    expect(applySuggestionPatch(
      "sqlmap",
      { ...base, dbs: true, columns: true, dump: true, database: "old" },
      { database: "app", tables: true },
    )).toEqual({
      ...base,
      dbs: false,
      columns: false,
      dump: false,
      database: "app",
      tables: true,
    });
  });

  it("builds an SSTImap retest patch without payload actions", () => {
    const findings: StructuredFinding[] = [
      { kind: "engine", value: "Jinja2" },
      { kind: "technique", value: "R", detail: "rendered" },
      { kind: "capability", value: "Shell command execution" },
    ];

    expect(buildTaskSuggestions("sstimap", base, findings)).toEqual([
      {
        id: "sstimap-retest-jinja2-r",
        label: "使用 Jinja2 / R 精准复测",
        patch: { engine: "Jinja2", technique: "R" },
      },
    ]);

    expect(applySuggestionPatch(
      "sstimap",
      { ...base, tplShell: true, osCommand: "id", upload: "local remote" },
      { engine: "Jinja2", technique: "R" },
    )).toEqual({
      ...base,
      tplShell: false,
      osCommand: "",
      upload: "",
      engine: "Jinja2",
      technique: "R",
    });
  });
});
