import type { PluginEdition } from "./pluginRegistry";

export interface ToolRunRequest {
  runId: string;
  toolId: "sqlmap" | "sstimap";
  edition: PluginEdition;
  arguments: string[];
}

const EXECUTABLES: Record<ToolRunRequest["toolId"], string> = {
  sqlmap: "sqlmap.cmd",
  sstimap: "sstimap.cmd",
};

export function createToolRunRequest(runId: string, toolId: ToolRunRequest["toolId"], edition: PluginEdition, command: string[]): ToolRunRequest {
  if (command[0] !== EXECUTABLES[toolId]) throw new Error("命令与工具不匹配");
  const argumentsList = command.slice(1);
  if (edition === "cn") {
    if (argumentsList[0] !== "-cn") throw new Error("汉化版命令缺少 -cn");
    argumentsList.shift();
  } else if (argumentsList[0] === "-cn") {
    throw new Error("原版命令不能包含 -cn");
  }
  return { runId, toolId, edition, arguments: argumentsList };
}
