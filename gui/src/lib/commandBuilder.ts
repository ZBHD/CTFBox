import type { PluginEdition } from "./pluginRegistry";

export type ParameterValue = string | boolean | number | undefined;
export type ToolParameters = Record<string, ParameterValue>;

export function buildCommand(
  toolId: string,
  edition: PluginEdition,
  parameters: ToolParameters,
): string[] {
  const executable = toolId === "sqlmap" ? "sqlmap.cmd" : toolId === "sstimap" ? "sstimap.cmd" : `${toolId}.cmd`;
  const argv = [executable];
  if (edition === "cn" && (toolId === "sqlmap" || toolId === "sstimap")) argv.push("-cn");

  if (toolId === "sqlmap") {
    if (typeof parameters.url === "string" && parameters.url.trim()) argv.push("--url", parameters.url.trim());
    if (parameters.database) argv.push("--dbs");
    if (parameters.tables) argv.push("--tables");
    if (parameters.columns) argv.push("--columns");
    if (parameters.batch) argv.push("--batch");
  } else if (toolId === "sstimap") {
    if (typeof parameters.url === "string" && parameters.url.trim()) argv.push("-u", parameters.url.trim());
    if (typeof parameters.payload === "string" && parameters.payload.trim()) argv.push("--data", parameters.payload.trim());
  } else {
    if (typeof parameters.input === "string" && parameters.input.trim()) argv.push(parameters.input.trim());
    if (typeof parameters.action === "string" && parameters.action.trim()) argv.push("--action", parameters.action.trim());
  }
  return argv;
}
