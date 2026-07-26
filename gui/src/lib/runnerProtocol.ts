import { getPlugin, runnerCommandName, type PluginEdition } from "./pluginRegistry";

export interface ToolRunRequest {
  runId: string;
  toolId: string;
  edition: PluginEdition;
  arguments: string[];
}

export function createToolRunRequest(runId: string, toolId: string, edition: PluginEdition, command: string[]): ToolRunRequest {
  const plugin = getPlugin(toolId);
  if (!plugin?.runner) throw new Error("工具未配置运行器");
  if (!plugin.editions?.includes(edition)) throw new Error("工具版本未配置");
  const commandName = runnerCommandName(plugin);
  if (!commandName) throw new Error("该工具不支持命令行调用");
  if (command[0] !== commandName) throw new Error("命令与工具不匹配");
  const argumentsList = command.slice(1);
  if (edition === "cn") {
    if (argumentsList[0] !== "-cn") throw new Error("汉化版命令缺少 -cn");
    argumentsList.shift();
  } else if (argumentsList[0] === "-cn") {
    throw new Error("原版命令不能包含 -cn");
  }
  return { runId, toolId, edition, arguments: argumentsList };
}
