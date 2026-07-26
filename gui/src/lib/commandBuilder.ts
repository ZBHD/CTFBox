import { getPlugin, type PluginEdition } from "./pluginRegistry";
import { getToolSchema } from "./toolSchemas";

export type ParameterValue = string | boolean | number | undefined;
export type ToolParameters = Record<string, ParameterValue>;

export function buildCommand(
  toolId: string,
  edition: PluginEdition,
  parameters: ToolParameters,
): string[] {
  const plugin = getPlugin(toolId);
  const executable = plugin?.runner?.launcher ?? `${toolId}.cmd`;
  const argv = [executable];
  if (edition === "cn" && plugin?.editions?.includes("cn")) argv.push("-cn");

  if (plugin?.category === "web" && plugin.runner) {
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
