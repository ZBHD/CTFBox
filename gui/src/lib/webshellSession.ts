import type { ToolStreamEvent } from "../state/taskStore";
import type { ToolRunRequest } from "./runnerProtocol";
import { getPlugin } from "./pluginRegistry";

/** webshell.py 引擎回传的事件（NDJSON 每行一个）。 */
export type WebshellEvent =
  | { ev: "connected"; info: WebshellServerInfo }
  | { ev: "exec"; cmd: string; output: string }
  | { ev: "listing"; path: string; entries: WebshellEntry[] }
  | { ev: "file"; path: string; encoding: "base64"; content: string }
  | { ev: "progress"; stage: string; path?: string; written?: number; done: boolean }
  | { ev: "error"; op: string | null; message: string };

export interface WebshellServerInfo {
  os?: string;
  user?: string;
  cwd?: string;
  [key: string]: unknown;
}

export interface WebshellEntry {
  name: string;
  type: string;
  size: number;
}

export interface WebshellConnectConfig {
  target: string;
  password: string;
  payloadType: "php" | "jsp" | "asp" | "aspx";
  encoder: "raw" | "base64";
}

/** 会话运行请求：session 工具不经命令行，直接以空参数启动引擎。 */
export function createSessionRunRequest(runId: string, toolId: string): ToolRunRequest {
  const plugin = getPlugin(toolId);
  if (plugin?.runner?.kind !== "session") throw new Error("该工具不是会话型工具");
  if (!plugin.editions?.includes("original")) throw new Error("会话工具缺少版本配置");
  return { runId, toolId, edition: "original", arguments: [] };
}

/** 后端传输适配层，便于测试注入内存实现替代 Tauri invoke。 */
export interface WebshellTransport {
  start(runId: string, request: ToolRunRequest, onEvent: (event: ToolStreamEvent) => void): Promise<void>;
  send(runId: string, line: string): Promise<void>;
  stop(runId: string): Promise<void>;
}

type PendingResolver = {
  resolve: (event: WebshellEvent) => void;
  reject: (error: Error) => void;
};

/**
 * 驱动单个 webshell 引擎进程：把 UI 操作串行化为 NDJSON 请求，
 * 逐行解析 stdout 事件并与挂起的操作配对。stderr 与非法行经 onLog 上报。
 */
export class WebshellSession {
  private readonly transport: WebshellTransport;
  private readonly runId: string;
  private readonly toolId: string;
  private started = false;
  private closed = false;
  private stdoutBuffer = "";
  private readonly pending: PendingResolver[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  onEvent?: (event: WebshellEvent) => void;
  onLog?: (text: string) => void;
  onExit?: (status: string) => void;

  constructor(transport: WebshellTransport, runId: string, toolId = "webshell") {
    this.transport = transport;
    this.runId = runId;
    this.toolId = toolId;
  }

  private handleStream(event: ToolStreamEvent) {
    if (event.event === "exit") {
      this.closed = true;
      const error = new Error(`会话已结束（${event.status}）`);
      while (this.pending.length > 0) this.pending.shift()!.reject(error);
      this.onExit?.(event.status);
      return;
    }
    if (event.event !== "output") return;
    if (event.stream === "stderr") {
      this.onLog?.(event.chunk);
      return;
    }
    this.stdoutBuffer += event.chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.consumeLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeLine(line: string) {
    let event: WebshellEvent;
    try {
      event = JSON.parse(line) as WebshellEvent;
    } catch {
      this.onLog?.(line);
      return;
    }
    if (typeof event?.ev !== "string") {
      this.onLog?.(line);
      return;
    }
    this.onEvent?.(event);
    const resolver = this.pending.shift();
    if (resolver) resolver.resolve(event);
  }

  /** 串行执行一个操作：发送请求行，等待下一个引擎事件。 */
  private run(op: Record<string, unknown>): Promise<WebshellEvent> {
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error("会话已关闭");
      if (!this.started) {
        this.started = true;
        await this.transport.start(this.runId, createSessionRunRequest(this.runId, this.toolId), (event) => this.handleStream(event));
      }
      const settled = new Promise<WebshellEvent>((resolve, reject) => {
        this.pending.push({ resolve, reject });
      });
      await this.transport.send(this.runId, JSON.stringify(op));
      return settled;
    });
    // 保持队列串行，且不因单个操作失败而中断后续操作。
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  connect(config: WebshellConnectConfig) {
    return this.run({ op: "connect", ...config });
  }

  exec(cmd: string) {
    return this.run({ op: "exec", cmd });
  }

  list(path: string) {
    return this.run({ op: "ls", path });
  }

  read(path: string) {
    return this.run({ op: "read", path });
  }

  upload(path: string, base64Content: string) {
    return this.run({ op: "upload", path, content: base64Content });
  }

  remove(path: string) {
    return this.run({ op: "delete", path });
  }

  async disconnect() {
    if (this.closed || !this.started) {
      this.closed = true;
      return;
    }
    try {
      await this.transport.send(this.runId, JSON.stringify({ op: "disconnect" }));
    } finally {
      this.closed = true;
      await this.transport.stop(this.runId).catch(() => undefined);
    }
  }
}
