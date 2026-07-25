import { StrictMode, type ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { type AppUpdateAdapter } from "./App";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToolRail } from "./components/ToolRail";
import { ModeControls } from "./components/workbench/ModeControls";
import { AutomationControls } from "./components/workbench/AutomationControls";
import { ParameterPanel } from "./components/workbench/ParameterPanel";
import { ResultsPanel } from "./components/workbench/ResultsPanel";
import {
  BUILT_IN_FLAG_PREFIXES,
  FLAG_PREFIX_PREFERENCE_STORAGE_KEY,
  FLAG_PREFIX_STORAGE_KEY,
} from "./lib/flagPrefixPreference";
import type { ToolStreamEvent } from "./state/taskStore";
import {
  UpdateRelaunchError,
  type CheckLatestOptions,
  type UpdateHandle,
  type UpdateResult,
  type UpdateState,
} from "./lib/updateManager";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
  invoke: vi.fn(() => Promise.reject(new Error("browser preview"))),
}));

type TestUpdateAdapter = AppUpdateAdapter;
const TestableApp = App as ComponentType<{ updateAdapter: AppUpdateAdapter }>;
const idleState: UpdateState = { phase: "idle", downloadedBytes: 0 };
const mounted: ReactTestRenderer[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function makeHandle(version = "0.2.0"): UpdateHandle {
  return {
    currentVersion: "0.1.0",
    version,
    date: "2026-07-25",
    body: "应用内更新。",
    download: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

function available(update: UpdateHandle): UpdateResult {
  return {
    state: {
      phase: "available",
      currentVersion: update.currentVersion,
      latestVersion: update.version,
      date: update.date,
      notes: update.body,
      downloadedBytes: 0,
    },
    update,
  };
}

function adapter(overrides: Partial<TestUpdateAdapter> = {}): TestUpdateAdapter {
  return {
    checkLatest: vi.fn(async () => ({ state: idleState })),
    downloadUpdate: vi.fn(async (update, previousState, onState) => {
      const state = { ...previousState, phase: "ready" as const };
      onState?.(state);
      return { state, update };
    }),
    installAndRelaunch: vi.fn(async () => undefined),
    relaunch: vi.fn(async () => undefined),
    openUrl: vi.fn(async () => undefined),
    ...overrides,
  };
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child))
    .join("");
}

function button(root: ReactTestInstance, label: string) {
  const match = root.findAllByType("button").find((candidate) => textContent(candidate).includes(label));
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderApp(updateAdapter: TestUpdateAdapter) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<TestableApp updateAdapter={updateAdapter} />);
  });
  mounted.push(renderer);
  return renderer;
}

function renderStrictApp(updateAdapter: TestUpdateAdapter) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <StrictMode>
        <TestableApp updateAdapter={updateAdapter} />
      </StrictMode>,
    );
  });
  mounted.push(renderer);
  return renderer;
}

async function openUpdateSettings(renderer: ReactTestRenderer) {
  act(() => button(renderer.root, "设置").props.onClick());
  act(() => button(renderer.root, "版本更新").props.onClick());
  await flush();
}

beforeEach(() => {
  const values = new Map<string, string>([
    ["ctfbox.theme", "light"],
    ["ctfbox.flagPrefixes", "flag, CTF"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  });
  vi.stubGlobal("document", {
    activeElement: null,
    body: {},
    documentElement: { dataset: {} },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  for (const renderer of mounted.splice(0)) {
    act(() => renderer.unmount());
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App update integration", () => {
  it("survives an explicitly simulated StrictMode cleanup and remount", async () => {
    const firstCheck = deferred<UpdateResult>();
    const discardedUpdate = makeHandle("0.2.0");
    const activeUpdate = makeHandle("0.3.0");
    const checkOptions: CheckLatestOptions[] = [];
    const checkLatest = vi.fn((options: CheckLatestOptions = {}) => {
      checkOptions.push(options);
      return checkOptions.length === 1
        ? firstCheck.promise
        : Promise.resolve(available(activeUpdate));
    });
    const updateAdapter = adapter({ checkLatest });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // React test renderer 18 marks strict roots but does not replay passive effects.
    // Explicitly cleanup and remount the StrictMode tree to simulate ReactDOM's dev cycle.
    const firstMount = renderStrictApp(updateAdapter);
    expect(checkLatest).toHaveBeenCalledOnce();
    act(() => firstMount.unmount());
    mounted.splice(mounted.indexOf(firstMount), 1);
    expect(checkOptions[0].signal?.aborted).toBe(true);

    const activeMount = renderStrictApp(updateAdapter);
    await flush();
    expect(checkLatest).toHaveBeenCalledTimes(2);
    expect(activeMount.root.findAllByProps({ "aria-label": "发现新版本 v0.3.0" })).toHaveLength(1);
    expect(activeUpdate.close).not.toHaveBeenCalled();

    await act(async () => firstCheck.resolve(available(discardedUpdate)));
    expect(discardedUpdate.close).toHaveBeenCalledOnce();
    expect(activeMount.root.findAllByProps({ "aria-label": "发现新版本 v0.3.0" })).toHaveLength(1);
    expect(activeMount.root.findAllByProps({ "aria-label": "发现新版本 v0.2.0" })).toHaveLength(0);

    act(() => activeMount.unmount());
    mounted.splice(mounted.indexOf(activeMount), 1);
    await flush();
    expect(activeUpdate.close).toHaveBeenCalledOnce();
    expect(discardedUpdate.close).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renders the main application before the silent startup check resolves", () => {
    const check = deferred<UpdateResult>();
    const renderer = renderApp(adapter({ checkLatest: vi.fn(() => check.promise) }));

    expect(textContent(renderer.root)).toContain("SQLmap");
    expect(textContent(renderer.root)).toContain("正在连接后端");
  });

  it("keeps a failed startup check silent and preserves the normal settings state", async () => {
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => { throw new Error("offline"); }),
    }));
    await flush();

    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(renderer.root.findAll((node) => String(node.props["aria-label"] ?? "").startsWith("发现新版本"))).toHaveLength(0);

    await openUpdateSettings(renderer);
    expect(textContent(renderer.root)).toContain("按需检查新版本");
    expect(textContent(renderer.root)).not.toContain("offline");
  });

  it("opens the only global settings view directly on the available update", async () => {
    const update = makeHandle();
    const renderer = renderApp(adapter({ checkLatest: vi.fn(async () => available(update)) }));
    await flush();

    const updateIcon = renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" });
    act(() => updateIcon.props.onClick());

    expect(textContent(renderer.root)).toContain("版本更新");
    expect(button(renderer.root, "版本更新").props["aria-current"]).toBe("page");
    expect(renderer.root.findAllByProps({ id: "settings-updates-title" })).toHaveLength(1);
  });

  it("downloads only after user action, reports progress, and postpones the ready dialog for this session", async () => {
    const update = makeHandle();
    const gate = deferred<void>();
    const relaunch = vi.fn(async () => undefined);
    const installAndRelaunch = vi.fn(async (_update: UpdateHandle, options?: { relaunch?: () => Promise<void> }) => {
      await options?.relaunch?.();
    });
    const downloadUpdate = vi.fn(async (
      ownedUpdate: UpdateHandle,
      previousState: UpdateState,
      onState?: (state: UpdateState) => void,
    ) => {
      onState?.({ ...previousState, phase: "downloading", downloadedBytes: 32, totalBytes: 128 });
      await gate.promise;
      const state = { ...previousState, phase: "ready" as const, downloadedBytes: 128, totalBytes: 128 };
      onState?.(state);
      return { state, update: ownedUpdate };
    });
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      downloadUpdate,
      installAndRelaunch,
      relaunch,
    }));
    await flush();
    expect(downloadUpdate).not.toHaveBeenCalled();

    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(textContent(renderer.root)).toContain("25%");
    await act(async () => gate.resolve());
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(1);

    act(() => button(renderer.root, "稍后重启").props.onClick());
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(textContent(renderer.root)).toContain("更新已准备好");

    act(() => button(renderer.root, "外观").props.onClick());
    act(() => button(renderer.root, "版本更新").props.onClick());
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    act(() => button(renderer.root, "立即重启").props.onClick());
    await flush();
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(installAndRelaunch).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("keeps the available update shortcut after a download failure", async () => {
    const update = makeHandle();
    const downloadUpdate = vi.fn(async (ownedUpdate: UpdateHandle, previousState: UpdateState) => ({
      state: {
        ...previousState,
        phase: "error" as const,
        error: "下载失败",
      },
      update: ownedUpdate,
    }));
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      downloadUpdate,
    }));
    await flush();

    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    expect(textContent(renderer.root)).toContain("下载更新失败");
    expect(renderer.root.findAllByProps({ "aria-label": "发现新版本 v0.2.0" })).toHaveLength(1);
  });

  it("retries only relaunch after installation succeeded and resets the busy guard after failure", async () => {
    const update = makeHandle();
    const installation = deferred<void>();
    const installAndRelaunch = vi.fn(() => installation.promise);
    const relaunch = vi.fn()
      .mockRejectedValueOnce(new Error("still running"))
      .mockResolvedValueOnce(undefined);
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      installAndRelaunch,
      relaunch,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    act(() => {
      button(renderer.root, "立即重启").props.onClick();
      button(renderer.root, "立即重启").props.onClick();
    });
    await flush();
    expect(installAndRelaunch).toHaveBeenCalledOnce();
    await act(async () => installation.reject(new UpdateRelaunchError(new Error("restart failed"))));

    expect(textContent(renderer.root)).toContain("重启应用失败");
    expect(textContent(renderer.root)).toContain("再次重启");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("ready");

    act(() => button(renderer.root, "稍后重启").props.onClick());
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    expect(textContent(renderer.root.findByProps({ role: "alert" }))).toContain("重启应用失败");

    act(() => button(renderer.root, "再次重启").props.onClick());
    await flush();
    expect(textContent(renderer.root)).toContain("重启应用失败");
    act(() => button(renderer.root, "再次重启").props.onClick());
    await flush();

    expect(installAndRelaunch).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledTimes(2);
  });

  it("keeps an install failure ready and retries installation with the downloaded handle", async () => {
    const update = makeHandle();
    const relaunch = vi.fn(async () => undefined);
    const installAndRelaunch = vi.fn()
      .mockImplementationOnce(() => { throw new Error("installer failed"); })
      .mockImplementationOnce(async (_update: UpdateHandle, options?: { relaunch?: () => Promise<void> }) => {
        await options?.relaunch?.();
      });
    const downloadUpdate = vi.fn(async (ownedUpdate: UpdateHandle, previousState: UpdateState, onState?: (state: UpdateState) => void) => {
      const state = { ...previousState, phase: "ready" as const };
      onState?.(state);
      return { state, update: ownedUpdate };
    });
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      downloadUpdate,
      installAndRelaunch,
      relaunch,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    act(() => button(renderer.root, "立即重启").props.onClick());
    await flush();

    expect(textContent(renderer.root)).toContain("安装更新失败");
    expect(textContent(renderer.root)).toContain("installer failed");
    expect(textContent(renderer.root)).toContain("重试安装");
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("ready");
    expect(update.close).not.toHaveBeenCalled();

    act(() => button(renderer.root, "重试安装").props.onClick());
    await flush();
    expect(installAndRelaunch).toHaveBeenCalledTimes(2);
    expect(relaunch).toHaveBeenCalledOnce();
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(update.close).not.toHaveBeenCalled();
    expect(textContent(renderer.root)).toContain("再次重启");
  });

  it("does not install twice when a successful relaunch call returns without exiting", async () => {
    const update = makeHandle();
    const installAndRelaunch = vi.fn(async () => undefined);
    const relaunch = vi.fn(async () => undefined);
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      installAndRelaunch,
      relaunch,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    act(() => button(renderer.root, "立即重启").props.onClick());
    await flush();
    expect(textContent(renderer.root)).toContain("再次重启");
    expect(textContent(renderer.root)).toContain("应用仍在运行");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    act(() => button(renderer.root, "再次重启").props.onClick());
    await flush();

    expect(installAndRelaunch).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("shows manual check errors and discards a late startup result after aborting it", async () => {
    const startup = deferred<UpdateResult>();
    const lateUpdate = makeHandle("0.3.0");
    const calls: CheckLatestOptions[] = [];
    const checkLatest = vi.fn((options: CheckLatestOptions = {}) => {
      calls.push(options);
      if (calls.length === 1) return startup.promise;
      options.onState?.({ phase: "checking", downloadedBytes: 0 });
      return Promise.resolve({
        state: { phase: "error" as const, downloadedBytes: 0, error: "GitHub unavailable" },
      });
    });
    const renderer = renderApp(adapter({ checkLatest }));
    await openUpdateSettings(renderer);

    act(() => button(renderer.root, "手动检查").props.onClick());
    await flush();
    expect(calls[0].signal?.aborted).toBe(true);
    expect(textContent(renderer.root)).toContain("GitHub unavailable");

    await act(async () => startup.resolve(available(lateUpdate)));
    expect(lateUpdate.close).toHaveBeenCalledOnce();
    expect(textContent(renderer.root)).toContain("GitHub unavailable");
    expect(textContent(renderer.root)).not.toContain("v0.3.0");
  });

  it("opens GitHub links through the adapter and never clears existing preferences", async () => {
    const openUrl = vi.fn(async () => undefined);
    const renderer = renderApp(adapter({ openUrl }));
    await flush();
    await openUpdateSettings(renderer);

    act(() => button(renderer.root, "GitHub").props.onClick());
    act(() => button(renderer.root, "更新日志").props.onClick());
    await flush();

    expect(openUrl).toHaveBeenNthCalledWith(1, "https://github.com/ZBHD/CTFBox");
    expect(openUrl).toHaveBeenNthCalledWith(2, "https://github.com/ZBHD/CTFBox/releases/latest");
    expect(localStorage.clear).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledWith("ctfbox.theme", "light");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      FLAG_PREFIX_STORAGE_KEY,
      BUILT_IN_FLAG_PREFIXES.join(", "),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      FLAG_PREFIX_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, enabled: [...BUILT_IN_FLAG_PREFIXES], custom: [] }),
    );
  });

  it("isolates synchronous and asynchronous link failures from an available update", async () => {
    const update = makeHandle();
    const openUrl = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync offline"); })
      .mockRejectedValueOnce(new Error("async offline"))
      .mockResolvedValueOnce(undefined);
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      openUrl,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());

    act(() => button(renderer.root, "GitHub").props.onClick());
    await flush();
    expect(textContent(renderer.root.findByProps({ role: "alert" }))).toContain("sync offline");
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("available");
    expect(update.close).not.toHaveBeenCalled();

    act(() => button(renderer.root, "更新日志").props.onClick());
    await flush();
    expect(textContent(renderer.root.findByProps({ role: "alert" }))).toContain("async offline");
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("available");

    act(() => button(renderer.root, "GitHub").props.onClick());
    await flush();
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("available");
    expect(update.close).not.toHaveBeenCalled();
  });

  it("clears a link error when a newer request starts and ignores an older late failure", async () => {
    const update = makeHandle();
    const pending = deferred<void>();
    const openUrl = vi.fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      openUrl,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());

    act(() => button(renderer.root, "GitHub").props.onClick());
    await flush();
    expect(textContent(renderer.root.findByProps({ role: "alert" }))).toContain("first failure");

    act(() => button(renderer.root, "更新日志").props.onClick());
    await flush();
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);

    act(() => button(renderer.root, "GitHub").props.onClick());
    await flush();
    expect(openUrl).toHaveBeenCalledTimes(3);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);

    await act(async () => pending.reject(new Error("late failure")));
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("available");
  });

  it("keeps a ready update restartable when opening a link fails", async () => {
    const update = makeHandle();
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      openUrl: vi.fn(async () => { throw new Error("link blocked"); }),
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();
    act(() => button(renderer.root, "稍后重启").props.onClick());

    act(() => button(renderer.root, "GitHub").props.onClick());
    await flush();
    expect(textContent(renderer.root.findByProps({ role: "alert" }))).toContain("link blocked");
    expect(renderer.root.findByType(SettingsPanel).props.updateState.phase).toBe("ready");
    expect(textContent(renderer.root)).toContain("立即重启");
    expect(update.close).not.toHaveBeenCalled();
  });

  it("ignores late download progress after unmount and closes the owned handle once", async () => {
    const update = makeHandle();
    const downloadResult = deferred<UpdateResult>();
    let reportState: ((state: UpdateState) => void) | undefined;
    const downloadUpdate = vi.fn((
      _ownedUpdate: UpdateHandle,
      _previousState: UpdateState,
      onState?: (state: UpdateState) => void,
    ) => {
      reportState = onState;
      return downloadResult.promise;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      downloadUpdate,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    act(() => renderer.unmount());
    mounted.splice(mounted.indexOf(renderer), 1);
    await flush();
    act(() => reportState?.({ phase: "downloading", downloadedBytes: 64, totalBytes: 128 }));
    await act(async () => downloadResult.resolve({
      state: { phase: "ready", downloadedBytes: 128, totalBytes: 128 },
      update,
    }));

    expect(update.close).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("closes a replaced handle once and retains the active handle until unmount", async () => {
    const first = makeHandle("0.2.0");
    const second = makeHandle("0.3.0");
    const checkLatest = vi.fn()
      .mockResolvedValueOnce(available(first))
      .mockResolvedValueOnce(available(second));
    const renderer = renderApp(adapter({ checkLatest }));
    await flush();
    await openUpdateSettings(renderer);

    act(() => renderer.root.findByType(SettingsPanel).props.onCheckUpdate());
    await flush();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    mounted.splice(mounted.indexOf(renderer), 1);
    await flush();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("waits for a click before running a suggested SQLmap command from analysis events", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "app_health"
      ? { app: "CTFBox", version: "0.1.0", platform: "windows" }
      : undefined);
    const renderer = renderApp(adapter());
    await flush();

    act(() => renderer.root.findByType(ParameterPanel).props.onChange("url", "TARGET_URL"));
    act(() => renderer.root.findByType(ModeControls).props.onRun());
    await flush();

    const runCalls = () => invokeMock.mock.calls.filter(([command]) => command === "run_tool");
    expect(runCalls()).toHaveLength(1);
    const firstPayload = runCalls()[0][1] as {
      request: { runId: string; arguments: string[] };
      onEvent: { onmessage?: (event: ToolStreamEvent) => void };
    };
    expect(renderer.root.findByType(ResultsPanel).props.suggestions).toEqual([]);

    act(() => {
      firstPayload.onEvent.onmessage?.({
        event: "output",
        runId: firstPayload.request.runId,
        stream: "stdout",
        chunk: "available databases [1]:\n[*] app\n",
      });
      firstPayload.onEvent.onmessage?.({
        event: "analysis",
        runId: firstPayload.request.runId,
        findings: [{ kind: "database", value: "app" }],
      });
      firstPayload.onEvent.onmessage?.({
        event: "exit",
        runId: firstPayload.request.runId,
        status: "completed",
        code: 0,
      });
    });

    expect(runCalls()).toHaveLength(1);
    expect(textContent(renderer.root)).toContain("available databases [1]");
    const suggestion = renderer.root.findByType(ResultsPanel).props.suggestions[0];
    expect(suggestion.patch).toEqual({ database: "app", tables: true });

    act(() => renderer.root.findByProps({ "aria-label": `执行建议：${suggestion.label}` }).props.onClick());
    await flush();

    expect(runCalls()).toHaveLength(2);
    const secondPayload = runCalls()[1][1] as { request: { arguments: string[] } };
    expect(secondPayload.request.arguments).toEqual([
      "--url",
      "TARGET_URL",
      "--tables",
      "-D",
      "app",
    ]);
    expect(textContent(renderer.root)).toContain("available databases [1]");
  });

  it("automatically advances SQLmap discovery into table enumeration and data export", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "app_health"
      ? { app: "CTFBox", version: "0.1.3", platform: "windows" }
      : undefined);
    const renderer = renderApp(adapter());
    await flush();
    act(() => renderer.root.findByType(ParameterPanel).props.onChange("url", "TARGET_URL"));
    act(() => renderer.root.findByType(AutomationControls).props.onStart());
    await flush();

    const runCalls = () => invokeMock.mock.calls.filter(([command]) => command === "run_tool");
    expect(runCalls()).toHaveLength(1);
    const first = runCalls()[0][1] as { request: { runId: string; arguments: string[] }; onEvent: { onmessage?: (event: ToolStreamEvent) => void } };
    expect(first.request.arguments).toEqual(["--url", "TARGET_URL", "--dbs", "--threads", "5", "--batch"]);

    act(() => renderer.root.findByType(ToolRail).props.onSelect({ toolId: "sstimap" }));

    act(() => {
      first.onEvent.onmessage?.({ event: "analysis", runId: first.request.runId, findings: [{ kind: "database", value: "app" }] });
      first.onEvent.onmessage?.({ event: "exit", runId: first.request.runId, status: "completed", code: 0 });
    });
    await flush();
    expect(runCalls()).toHaveLength(2);
    const second = runCalls()[1][1] as { request: { runId: string; arguments: string[] }; onEvent: { onmessage?: (event: ToolStreamEvent) => void } };
    expect(second.request.arguments).toEqual(["--url", "TARGET_URL", "--tables", "-D", "app", "--threads", "5", "--batch"]);

    act(() => {
      second.onEvent.onmessage?.({ event: "analysis", runId: second.request.runId, findings: [{ kind: "table", value: "flags", database: "app" }] });
      second.onEvent.onmessage?.({ event: "exit", runId: second.request.runId, status: "completed", code: 0 });
    });
    await flush();
    expect(runCalls()).toHaveLength(3);
    expect((runCalls()[2][1] as { request: { arguments: string[] } }).request.arguments).toEqual([
      "--url", "TARGET_URL", "-D", "app", "-T", "flags", "--dump", "--threads", "5", "--batch",
    ]);
  });

  it("automatically advances SSTImap discovery into bounded flag searches", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "app_health"
      ? { app: "CTFBox", version: "0.1.3", platform: "windows" }
      : undefined);
    const renderer = renderApp(adapter());
    await flush();
    act(() => renderer.root.findByType(ToolRail).props.onSelect({ toolId: "sstimap" }));
    act(() => renderer.root.findByType(ParameterPanel).props.onChange("url", "TARGET_URL"));
    act(() => renderer.root.findByType(AutomationControls).props.onStart());
    await flush();

    const runCalls = () => invokeMock.mock.calls.filter(([command]) => command === "run_tool");
    expect(runCalls()).toHaveLength(1);
    const first = runCalls()[0][1] as { request: { runId: string; arguments: string[] }; onEvent: { onmessage?: (event: ToolStreamEvent) => void } };
    expect(first.request.arguments).toEqual(["-u", "TARGET_URL", "--no-color"]);

    act(() => {
      first.onEvent.onmessage?.({
        event: "analysis",
        runId: first.request.runId,
        findings: [
          { kind: "engine", value: "Jinja2" },
          { kind: "technique", value: "R" },
          { kind: "capability", value: "Shell command execution" },
        ],
      });
      first.onEvent.onmessage?.({ event: "exit", runId: first.request.runId, status: "completed", code: 0 });
    });
    await flush();

    expect(runCalls()).toHaveLength(4);
    const searches = runCalls().slice(1).map(([, payload]) => (payload as { request: { arguments: string[] } }).request.arguments);
    expect(searches).toHaveLength(3);
    expect(searches.every((argumentsList) => argumentsList.slice(0, 6).join("\u0000") === ["-u", "TARGET_URL", "-e", "Jinja2", "-r", "R"].join("\u0000"))).toBe(true);
    expect(searches.every((argumentsList) => argumentsList.includes("-S") && argumentsList.includes("--no-color"))).toBe(true);
  });

  it("stops the automation queue when the shared stop control is used", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "app_health"
      ? { app: "CTFBox", version: "0.1.3", platform: "windows" }
      : undefined);
    const renderer = renderApp(adapter());
    await flush();
    act(() => renderer.root.findByType(ParameterPanel).props.onChange("url", "TARGET_URL"));
    act(() => renderer.root.findByType(AutomationControls).props.onStart());
    await flush();
    const runCalls = () => invokeMock.mock.calls.filter(([command]) => command === "run_tool");
    const first = runCalls()[0][1] as { request: { runId: string }; onEvent: { onmessage?: (event: ToolStreamEvent) => void } };

    act(() => renderer.root.findByType(ModeControls).props.onRun());
    act(() => {
      first.onEvent.onmessage?.({ event: "analysis", runId: first.request.runId, findings: [{ kind: "database", value: "app" }] });
      first.onEvent.onmessage?.({ event: "exit", runId: first.request.runId, status: "stopped", code: null });
    });
    await flush();

    expect(runCalls()).toHaveLength(1);
  });
});
