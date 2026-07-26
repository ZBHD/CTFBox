import { Channel, invoke } from "@tauri-apps/api/core";
import type { ToolStreamEvent } from "../state/taskStore";
import type { ToolRunRequest } from "./runnerProtocol";
import type { WebshellTransport } from "./webshellSession";

/** 基于 Tauri 命令的 webshell 传输：run_tool 启动引擎，send/stop 复用现有命令。 */
export function createTauriTransport(): WebshellTransport {
  return {
    async start(_runId: string, request: ToolRunRequest, onEvent: (event: ToolStreamEvent) => void) {
      const channel = new Channel<ToolStreamEvent>();
      channel.onmessage = onEvent;
      await invoke("run_tool", { request, onEvent: channel });
    },
    async send(runId: string, line: string) {
      await invoke("send_tool_input", { runId, input: line });
    },
    async stop(runId: string) {
      await invoke("stop_tool", { runId });
    },
  };
}
