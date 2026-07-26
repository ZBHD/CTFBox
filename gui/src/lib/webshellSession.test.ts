import { describe, expect, it, vi } from "vitest";
import type { ToolStreamEvent } from "../state/taskStore";
import { WebshellSession, createSessionRunRequest, type WebshellTransport } from "./webshellSession";

/** 等待惰性启动与串行队列的微任务落地。 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 内存假引擎：解析发来的 op，逐行回吐 NDJSON 事件，模拟 webshell.py 的契约。 */
function fakeTransport(overrides: Partial<WebshellTransport> = {}) {
  const state: { emit?: (event: ToolStreamEvent) => void; runId?: string; lines: string[] } = { lines: [] };
  const emitEvent = (event: unknown) => {
    state.emit?.({ event: "output", runId: state.runId!, stream: "stdout", chunk: `${JSON.stringify(event)}\n` });
  };
  const transport: WebshellTransport = {
    start: vi.fn(async (runId, _request, onEvent) => {
      state.runId = runId;
      state.emit = onEvent;
    }),
    send: vi.fn(async (_runId, line) => {
      state.lines.push(line);
      const op = JSON.parse(line);
      if (op.op === "connect") emitEvent({ ev: "connected", info: { os: "linux", user: "www-data", cwd: "/var/www" } });
      else if (op.op === "exec") emitEvent({ ev: "exec", cmd: op.cmd, output: `executed:${op.cmd}` });
      else if (op.op === "ls") emitEvent({ ev: "listing", path: op.path, entries: [{ name: "a.php", type: "file", size: 12 }] });
      else if (op.op === "read") emitEvent({ ev: "file", path: op.path, encoding: "base64", content: "cm9vdA==" });
      else if (op.op === "upload") emitEvent({ ev: "progress", stage: "upload", path: op.path, written: 9, done: true });
      else if (op.op === "delete") emitEvent({ ev: "progress", stage: "delete", path: op.path, done: true });
      else if (op.op === "disconnect") emitEvent({ ev: "progress", stage: "disconnect", done: true });
    }),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
  return { transport, state, emitEvent };
}

describe("webshell session request", () => {
  it("builds an empty-argument session run request", () => {
    expect(createSessionRunRequest("run-1", "webshell")).toEqual({
      runId: "run-1",
      toolId: "webshell",
      edition: "original",
      arguments: [],
    });
  });

  it("rejects non-session tools", () => {
    expect(() => createSessionRunRequest("run-1", "sqlmap")).toThrow();
  });
});

describe("webshell session client", () => {
  it("starts the engine lazily and pairs each op with its event", async () => {
    const { transport } = fakeTransport();
    const session = new WebshellSession(transport, "run-1");

    const connected = await session.connect({ target: "http://h/s.php", password: "p", payloadType: "php", encoder: "base64" });
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(connected).toMatchObject({ ev: "connected", info: { user: "www-data" } });

    const exec = await session.exec("id");
    expect(exec).toMatchObject({ ev: "exec", output: "executed:id" });

    const listing = await session.list("/var/www");
    expect(listing).toMatchObject({ ev: "listing", entries: [{ name: "a.php" }] });

    const file = await session.read("/etc/passwd");
    expect(file).toMatchObject({ ev: "file", encoding: "base64", content: "cm9vdA==" });

    expect(transport.start).toHaveBeenCalledTimes(1); // 仅启动一次
  });

  it("serializes concurrent operations in submission order", async () => {
    const { transport, state } = fakeTransport();
    const session = new WebshellSession(transport, "run-1");

    const [first, second] = await Promise.all([session.exec("one"), session.exec("two")]);
    expect(first).toMatchObject({ output: "executed:one" });
    expect(second).toMatchObject({ output: "executed:two" });
    expect(state.lines.map((line) => JSON.parse(line).cmd)).toEqual(["one", "two"]);
  });

  it("streams unsolicited events through onEvent and buffers split lines", async () => {
    const { transport, state } = fakeTransport({
      send: vi.fn(async () => undefined), // 不自动回应，手动分片投递
    });
    const seen: string[] = [];
    const session = new WebshellSession(transport, "run-1");
    session.onEvent = (event) => seen.push(event.ev);

    const pending = session.exec("id");
    await tick();
    // 把一行 NDJSON 拆成两个 chunk 投递，验证行缓冲重组。
    state.emit!({ event: "output", runId: "run-1", stream: "stdout", chunk: '{"ev":"exec","cmd":"id",' });
    state.emit!({ event: "output", runId: "run-1", stream: "stdout", chunk: '"output":"ok"}\n' });
    const result = await pending;
    expect(result).toMatchObject({ ev: "exec", output: "ok" });
    expect(seen).toEqual(["exec"]);
  });

  it("routes stderr and malformed lines to onLog without pairing", async () => {
    const { transport, state } = fakeTransport({ send: vi.fn(async () => undefined) });
    const logs: string[] = [];
    const session = new WebshellSession(transport, "run-1");
    session.onLog = (text) => logs.push(text);

    void session.exec("id");
    await tick();
    state.emit!({ event: "output", runId: "run-1", stream: "stderr", chunk: "traceback\n" });
    state.emit!({ event: "output", runId: "run-1", stream: "stdout", chunk: "not-json\n" });
    await Promise.resolve();
    expect(logs).toContain("traceback\n");
    expect(logs).toContain("not-json");
  });

  it("rejects pending operations when the process exits", async () => {
    const { transport, state } = fakeTransport({ send: vi.fn(async () => undefined) });
    const session = new WebshellSession(transport, "run-1");
    const onExit = vi.fn();
    session.onExit = onExit;

    const pending = session.exec("id");
    await tick();
    state.emit!({ event: "exit", runId: "run-1", status: "failed" });
    await expect(pending).rejects.toThrow(/会话已结束/);
    expect(onExit).toHaveBeenCalledWith("failed");
  });

  it("delivers an error event as the paired result", async () => {
    const { transport } = fakeTransport({
      send: vi.fn(async (_runId, _line) => undefined),
    });
    const session = new WebshellSession(transport, "run-1");
    const pendingConnect = session.connect({ target: "bad", password: "p", payloadType: "php", encoder: "raw" });
    await tick();
    // 手动回吐 error 事件
    (transport.start as ReturnType<typeof vi.fn>).mock.calls[0][2]({
      event: "output", runId: "run-1", stream: "stdout",
      chunk: '{"ev":"error","op":"connect","message":"网络错误"}\n',
    });
    const result = await pendingConnect;
    expect(result).toMatchObject({ ev: "error", op: "connect", message: "网络错误" });
  });

  it("sends disconnect then stops the process", async () => {
    const { transport, state } = fakeTransport();
    const session = new WebshellSession(transport, "run-1");
    await session.connect({ target: "http://h/s.php", password: "p", payloadType: "php", encoder: "raw" });
    await session.disconnect();
    expect(state.lines.some((line) => JSON.parse(line).op === "disconnect")).toBe(true);
    expect(transport.stop).toHaveBeenCalledWith("run-1");
  });
});
