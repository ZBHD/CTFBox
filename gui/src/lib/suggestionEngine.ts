import type { StructuredFinding } from "../state/taskStore";
import type { ToolParameters } from "./commandBuilder";

export interface TaskSuggestion {
  id: string;
  label: string;
  patch: ToolParameters;
  commandPreview?: string;
}

const SQLMAP_ACTIONS = ["dbs", "tables", "columns", "dump"] as const;
const SSTIMAP_PAYLOAD_ACTIONS = [
  "tplShell",
  "tplCode",
  "evalShell",
  "evalCode",
  "osShell",
  "osCommand",
  "bindShell",
  "reverseShell",
  "remoteShell",
  "forceOverwrite",
  "upload",
  "download",
] as const;

function textParameter(parameters: ToolParameters, key: string) {
  const value = parameters[key];
  return typeof value === "string" ? value.trim() : "";
}

function uniqueFindingValues(
  findings: StructuredFinding[],
  kind: string,
  context: { database?: string; table?: string } = {},
) {
  return Array.from(new Set(findings
    .filter((finding) => finding.kind === kind)
    .filter((finding) => !context.database || finding.database === context.database)
    .filter((finding) => !context.table || finding.table === context.table)
    .map((finding) => finding.value.trim())
    .filter(Boolean)));
}

function selectedOrOnly(selected: string, candidates: string[]) {
  if (selected) return selected;
  return candidates.length === 1 ? candidates[0] : "";
}

function idPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "");
}

export function applySuggestionPatch(
  toolId: string,
  current: ToolParameters,
  patch: ToolParameters,
): ToolParameters {
  const next = { ...current };
  if (toolId === "sqlmap") {
    for (const action of SQLMAP_ACTIONS) {
      if (next[action] === true) next[action] = false;
    }
  }
  if (toolId === "sstimap") {
    for (const action of SSTIMAP_PAYLOAD_ACTIONS) {
      if (next[action] === undefined || next[action] === false || next[action] === "") continue;
      next[action] = typeof next[action] === "boolean" ? false : "";
    }
  }
  return { ...next, ...patch };
}

function buildSqlmapSuggestions(
  parameters: ToolParameters,
  findings: StructuredFinding[],
): TaskSuggestion[] {
  const hasEvidence = findings.some((finding) => [
    "injection-point",
    "dbms",
    "database",
    "table",
    "column",
  ].includes(finding.kind));
  if (!hasEvidence) return [];

  const databases = uniqueFindingValues(findings, "database");
  const database = selectedOrOnly(textParameter(parameters, "database"), databases);
  if (!database) {
    if (databases.length > 1) return [];
    return [{
      id: "sqlmap-enumerate-databases",
      label: "枚举可用数据库",
      patch: { dbs: true },
    }];
  }

  const tables = uniqueFindingValues(findings, "table", { database });
  const table = selectedOrOnly(textParameter(parameters, "table"), tables);
  if (!table) {
    if (tables.length > 1) return [];
    return [{
      id: `sqlmap-enumerate-tables-${idPart(database)}`,
      label: `枚举 ${database} 的数据表`,
      patch: { database, tables: true },
    }];
  }

  const columns = uniqueFindingValues(findings, "column", { database, table });
  const column = selectedOrOnly(textParameter(parameters, "column"), columns);
  if (!column) {
    if (columns.length > 1) return [];
    return [{
      id: `sqlmap-enumerate-columns-${idPart(database)}-${idPart(table)}`,
      label: `枚举 ${database}.${table} 的字段`,
      patch: { database, table, columns: true },
    }];
  }

  return [{
    id: `sqlmap-dump-${idPart(database)}-${idPart(table)}-${idPart(column)}`,
    label: `导出 ${database}.${table}.${column}`,
    patch: { database, table, column, dump: true },
  }];
}

function buildSstimapSuggestions(
  parameters: ToolParameters,
  findings: StructuredFinding[],
): TaskSuggestion[] {
  const engines = uniqueFindingValues(findings, "engine");
  const techniques = uniqueFindingValues(findings, "technique");
  const engine = selectedOrOnly(textParameter(parameters, "engine"), engines);
  const technique = selectedOrOnly(textParameter(parameters, "technique"), techniques);
  if (!engine || !technique) return [];
  if ((!textParameter(parameters, "engine") && engines.length > 1)
    || (!textParameter(parameters, "technique") && techniques.length > 1)) {
    return [];
  }
  return [{
    id: `sstimap-retest-${idPart(engine)}-${idPart(technique)}`,
    label: `使用 ${engine} / ${technique} 精准复测`,
    patch: { engine, technique },
  }];
}

export function buildTaskSuggestions(
  toolId: string,
  parameters: ToolParameters,
  findings: StructuredFinding[],
): TaskSuggestion[] {
  if (toolId === "sqlmap") return buildSqlmapSuggestions(parameters, findings);
  if (toolId === "sstimap") return buildSstimapSuggestions(parameters, findings);
  return [];
}
