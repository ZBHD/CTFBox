import type { PluginEdition } from "./pluginRegistry";
import { getToolSchema } from "./toolSchemas";

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

  if (toolId === "sqlmap" || toolId === "sstimap") {
    for (const field of getToolSchema(toolId).fields) {
      const value = parameters[field.id];
      if (field.control === "boolean") {
        if (value === true) argv.push(field.flag);
        continue;
      }
      if (value === undefined || value === "" || value === false) continue;
      const text = String(value).trim();
      if (!text) continue;
      if (field.repeatable) {
        for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
          argv.push(field.flag, line);
        }
      } else if (field.valueArity && field.valueArity > 1) {
        argv.push(field.flag, ...text.split(/\s+/).slice(0, field.valueArity));
      } else {
        argv.push(field.flag, text);
      }
    }
  } else {
    if (typeof parameters.input === "string" && parameters.input.trim()) argv.push(parameters.input.trim());
    if (typeof parameters.action === "string" && parameters.action.trim()) argv.push("--action", parameters.action.trim());
  }
  return argv;
}
