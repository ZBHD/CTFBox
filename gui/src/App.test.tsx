import type { ComponentType } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { type AppUpdateAdapter } from "./App";
import { SettingsPanel } from "./components/SettingsPanel";
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

    act(() => button(renderer.root, "立即重启").props.onClick());
    await flush();
    act(() => button(renderer.root, "立即重启").props.onClick());
    await flush();

    expect(installAndRelaunch).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledTimes(2);
  });

  it("shows an install error, releases busy state, and retains the handle for a user retry", async () => {
    const update = makeHandle();
    const installAndRelaunch = vi.fn(() => { throw new Error("installer failed"); });
    const renderer = renderApp(adapter({
      checkLatest: vi.fn(async () => available(update)),
      installAndRelaunch,
    }));
    await flush();
    act(() => renderer.root.findByProps({ "aria-label": "发现新版本 v0.2.0" }).props.onClick());
    act(() => button(renderer.root, "更新到 v0.2.0").props.onClick());
    await flush();

    act(() => button(renderer.root, "立即重启").props.onClick());
    await flush();

    expect(textContent(renderer.root)).toContain("installer failed");
    expect(textContent(renderer.root)).toContain("重新下载");
    expect(update.close).not.toHaveBeenCalled();
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
    act(() => button(renderer.root, "立即重启").props.onClick());
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
    expect(localStorage.setItem).toHaveBeenCalledWith("ctfbox.flagPrefixes", "flag, CTF");
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
});
