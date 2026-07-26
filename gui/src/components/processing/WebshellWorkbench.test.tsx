import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ToolStreamEvent } from "../../state/taskStore";
import type { WebshellTransport } from "../../lib/webshellSession";
import { WebshellWorkbench } from "./WebshellWorkbench";

/** 内存假引擎传输：解析发来的 op，逐行回吐 NDJSON 事件。 */
function fakeTransport(): { transport: WebshellTransport; lines: string[] } {
  const bridge: { emit?: (event: ToolStreamEvent) => void; runId?: string } = {};
  const lines: string[] = [];
  const emit = (event: unknown) =>
    bridge.emit?.({ event: "output", runId: bridge.runId!, stream: "stdout", chunk: `${JSON.stringify(event)}\n` });
  const transport: WebshellTransport = {
    start: vi.fn(async (runId, _request, onEvent) => {
      bridge.runId = runId;
      bridge.emit = onEvent;
    }),
    send: vi.fn(async (_runId, line) => {
      lines.push(line);
      const op = JSON.parse(line);
      if (op.op === "connect") emit({ ev: "connected", info: { os: "linux", user: "www-data", cwd: "/var/www" } });
      else if (op.op === "exec") emit({ ev: "exec", cmd: op.cmd, output: `run:${op.cmd}` });
      else if (op.op === "ls") emit({ ev: "listing", path: op.path, entries: [{ name: "flag.txt", type: "file", size: 20 }] });
      else if (op.op === "read") emit({ ev: "file", path: op.path, encoding: "base64", content: btoa("flag{demo}") });
      else if (op.op === "delete") emit({ ev: "progress", stage: "delete", path: op.path, done: true });
    }),
    stop: vi.fn(async () => undefined),
  };
  return { transport, lines };
}

function findButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.findAll((node) => node.type === "button" && collectText(node).includes(label))[0];
}

function collectText(node: ReactTestInstance): string {
  return node.findAll(() => true)
    .map((child) => child.children.filter((value): value is string => typeof value === "string").join(""))
    .join("") + node.children.filter((value): value is string => typeof value === "string").join("");
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("WebshellWorkbench", () => {
  it("connects, shows server info, runs a command and browses files", async () => {
    const { transport, lines } = fakeTransport();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<WebshellWorkbench transport={transport} runId="run-1" />);
    });
    const root = renderer.root;

    // 填写目标并连接
    const targetInput = root.findAllByType("input").find((node) => node.props.placeholder === "http://host/shell.php")!;
    act(() => targetInput.props.onChange({ target: { value: "http://h/s.php" } }));
    await act(async () => { findButton(root, "连接").props.onClick(); });
    await flush();

    expect(transport.start).toHaveBeenCalledTimes(1);
    const infoText = collectText(root.findByProps({ className: "webshell-serverinfo" }));
    expect(infoText).toContain("www-data");

    // 执行命令
    const cmdInput = root.findAllByType("input").find((node) => node.props.placeholder === "输入命令后回车执行")!;
    act(() => cmdInput.props.onChange({ target: { value: "id" } }));
    await act(async () => { root.findByProps({ className: "webshell-terminal-input" }).props.onSubmit({ preventDefault() {} }); });
    await flush();
    expect(collectText(root.findByProps({ className: "webshell-terminal-log" }))).toContain("run:id");

    // 切换到文件页并列目录
    await act(async () => { findButton(root, "文件").props.onClick(); });
    await flush();
    expect(collectText(root.findByProps({ className: "webshell-entry-list" }))).toContain("flag.txt");

    // 读取文件，验证 base64 解码
    await act(async () => { findButton(root, "flag.txt").props.onClick(); });
    await flush();
    expect(collectText(root.findByProps({ className: "webshell-file-view" }))).toContain("flag{demo}");

    // 断开
    await act(async () => { findButton(root, "断开").props.onClick(); });
    await flush();
    expect(lines.some((line) => JSON.parse(line).op === "disconnect")).toBe(true);
    expect(transport.stop).toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("surfaces connection errors from the engine", async () => {
    const bridge: { emit?: (event: ToolStreamEvent) => void } = {};
    const transport: WebshellTransport = {
      start: vi.fn(async (_runId, _request, onEvent) => { bridge.emit = onEvent; }),
      send: vi.fn(async (runId) => {
        bridge.emit?.({ event: "output", runId, stream: "stdout", chunk: '{"ev":"error","op":"connect","message":"目标不可达"}\n' });
      }),
      stop: vi.fn(async () => undefined),
    };
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<WebshellWorkbench transport={transport} runId="run-2" />); });
    const root = renderer.root;
    const targetInput = root.findAllByType("input").find((node) => node.props.placeholder === "http://host/shell.php")!;
    act(() => targetInput.props.onChange({ target: { value: "http://bad/s.php" } }));
    await act(async () => { findButton(root, "连接").props.onClick(); });
    await flush();

    expect(collectText(root.findByProps({ className: "local-status local-status-error" }))).toContain("目标不可达");
    act(() => renderer.unmount());
  });
});
