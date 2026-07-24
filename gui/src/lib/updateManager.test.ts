import { describe, expect, it, vi } from "vitest";
import {
  checkLatest,
  downloadUpdate,
  formatUpdateError,
  installAndRelaunch,
  UpdateRelaunchError,
  type DownloadEvent,
  type UpdateHandle,
  type UpdateState,
} from "./updateManager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createUpdate(overrides: Partial<UpdateHandle> = {}): UpdateHandle {
  return {
    currentVersion: "0.1.0",
    version: "0.2.0",
    date: "2026-07-24T12:00:00Z",
    body: "修复已知问题",
    download: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function availableState(): UpdateState {
  return {
    phase: "available",
    currentVersion: "0.1.0",
    latestVersion: "0.2.0",
    date: "2026-07-24T12:00:00Z",
    notes: "修复已知问题",
    downloadedBytes: 0,
  };
}

describe("update manager", () => {
  it("returns available metadata and keeps the update handle open", async () => {
    const update = createUpdate();

    const result = await checkLatest({ check: async () => update });

    expect(result).toEqual({ state: availableState(), update });
    expect(update.close).not.toHaveBeenCalled();
  });

  it("returns latest when the updater finds no release", async () => {
    const result = await checkLatest({ check: async () => null });

    expect(result).toEqual({
      state: { phase: "latest", downloadedBytes: 0 },
    });
  });

  it("keeps silent check failures invisible but exposes manual check failures", async () => {
    const check = async () => { throw new Error("网络不可用"); };

    await expect(checkLatest({ check, silent: true })).resolves.toEqual({
      state: { phase: "idle", downloadedBytes: 0 },
    });
    await expect(checkLatest({ check })).resolves.toEqual({
      state: {
        phase: "error",
        downloadedBytes: 0,
        error: "网络不可用",
      },
    });
  });

  it("does not publish transient states when a slow silent check fails", async () => {
    const pendingCheck = deferred<UpdateHandle | null>();
    const observed: UpdateState[] = [];
    const resultPromise = checkLatest({
      check: () => pendingCheck.promise,
      silent: true,
      onState: (state) => { observed.push(state); },
    });

    expect(observed).toEqual([]);
    pendingCheck.reject(new Error("网络不可用"));

    await expect(resultPromise).resolves.toEqual({
      state: { phase: "idle", downloadedBytes: 0 },
    });
    expect(observed).toEqual([]);
  });

  it("closes a stale update and does not publish it after cancellation", async () => {
    const pendingCheck = deferred<UpdateHandle | null>();
    const update = createUpdate();
    const controller = new AbortController();
    const observed: UpdateState[] = [];
    const resultPromise = checkLatest({
      check: () => pendingCheck.promise,
      silent: true,
      signal: controller.signal,
      onState: (state) => { observed.push(state); },
    });

    controller.abort();
    pendingCheck.resolve(update);

    await expect(resultPromise).resolves.toEqual({
      state: { phase: "idle", downloadedBytes: 0 },
    });
    expect(observed).toEqual([]);
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("closes a checked update and preserves a state listener exception", async () => {
    const update = createUpdate();
    const listenerError = new Error("渲染状态失败");

    const resultPromise = checkLatest({
      check: async () => update,
      silent: true,
      onState: () => { throw listenerError; },
    });

    await expect(resultPromise).rejects.toBe(listenerError);
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("accumulates download chunks and reports a ready state", async () => {
    const update = createUpdate({
      download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: "Started", data: { contentLength: 1024 } });
        onEvent({ event: "Progress", data: { chunkLength: 256 } });
        onEvent({ event: "Progress", data: { chunkLength: 512 } });
        onEvent({ event: "Finished" });
      }),
    });
    const observed: UpdateState[] = [];

    const result = await downloadUpdate(update, availableState(), (state) => {
      observed.push(state);
    });

    expect(observed).toContainEqual({
      ...availableState(),
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: 1024,
    });
    expect(observed).toContainEqual({
      ...availableState(),
      phase: "downloading",
      downloadedBytes: 768,
      totalBytes: 1024,
    });
    expect(result).toEqual({
      update,
      state: {
        ...availableState(),
        phase: "ready",
        downloadedBytes: 768,
        totalBytes: 1024,
      },
    });
    expect(update.install).not.toHaveBeenCalled();
    expect(update.close).not.toHaveBeenCalled();
  });

  it("returns an error state with existing metadata when download fails", async () => {
    const update = createUpdate({
      download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: "Started", data: { contentLength: 1024 } });
        onEvent({ event: "Progress", data: { chunkLength: 256 } });
        throw "连接中断";
      }),
    });

    const result = await downloadUpdate(update, availableState());

    expect(result).toEqual({
      update,
      state: {
        ...availableState(),
        phase: "error",
        downloadedBytes: 256,
        totalBytes: 1024,
        error: "连接中断",
      },
    });
  });

  it("waits for an asynchronous Finished event before becoming ready", async () => {
    const update = createUpdate({
      download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: "Started", data: { contentLength: 1024 } });
        onEvent({ event: "Progress", data: { chunkLength: 256 } });
        setTimeout(() => {
          onEvent({ event: "Progress", data: { chunkLength: 512 } });
          onEvent({ event: "Finished" });
        }, 5);
      }),
    });

    const result = await downloadUpdate(update, availableState());

    expect(result.state).toMatchObject({
      phase: "ready",
      downloadedBytes: 768,
      totalBytes: 1024,
    });
  });

  it("ignores events arriving after the download is ready", async () => {
    let emit!: (event: DownloadEvent) => void;
    const update = createUpdate({
      download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        emit = onEvent;
        onEvent({ event: "Progress", data: { chunkLength: 64 } });
        onEvent({ event: "Finished" });
      }),
    });
    const observed: UpdateState[] = [];

    const result = await downloadUpdate(update, availableState(), (state) => {
      observed.push(state);
    });
    const notificationCount = observed.length;
    emit({ event: "Progress", data: { chunkLength: 128 } });

    expect(result.state).toMatchObject({ phase: "ready", downloadedBytes: 64 });
    expect(observed).toHaveLength(notificationCount);
  });

  it("becomes ready when the total download size is unknown", async () => {
    const update = createUpdate({
      download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: "Started", data: {} });
        onEvent({ event: "Progress", data: { chunkLength: 64 } });
        onEvent({ event: "Finished" });
      }),
    });

    const result = await downloadUpdate(update, availableState());

    expect(result.state).toMatchObject({ phase: "ready", downloadedBytes: 64 });
    expect(result.state.totalBytes).toBeUndefined();
  });

  it("preserves a download state listener exception", async () => {
    const listenerError = new Error("进度渲染失败");
    const update = createUpdate({
      download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: "Started", data: { contentLength: 1024 } });
        onEvent({ event: "Finished" });
      }),
    });
    let notifications = 0;

    const resultPromise = downloadUpdate(update, availableState(), () => {
      notifications += 1;
      if (notifications === 2) throw listenerError;
    });

    await expect(resultPromise).rejects.toBe(listenerError);
  });

  it("installs before relaunching", async () => {
    const calls: string[] = [];
    const update = createUpdate({
      install: vi.fn(async () => { calls.push("install"); }),
    });
    const relaunch = vi.fn(async () => { calls.push("relaunch"); });

    await installAndRelaunch(update, { relaunch });

    expect(calls).toEqual(["install", "relaunch"]);
  });

  it("does not relaunch when installation fails", async () => {
    const update = createUpdate({
      install: vi.fn(async () => { throw new Error("安装失败"); }),
    });
    const relaunch = vi.fn(async () => undefined);

    await expect(installAndRelaunch(update, { relaunch })).rejects.toThrow("安装失败");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("marks relaunch failures as already installed without retrying install", async () => {
    const update = createUpdate();
    const relaunchCause = new Error("进程重启失败");
    const relaunch = vi.fn(async () => { throw relaunchCause; });

    const resultPromise = installAndRelaunch(update, { relaunch });

    await expect(resultPromise).rejects.toMatchObject({
      name: "UpdateRelaunchError",
      installed: true,
      cause: relaunchCause,
    });
    await expect(resultPromise).rejects.toBeInstanceOf(UpdateRelaunchError);
    expect(update.install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("formats Error, string, structured unknown and empty values consistently", () => {
    expect(formatUpdateError(new Error("请求超时"))).toBe("请求超时");
    expect(formatUpdateError("签名无效")).toBe("签名无效");
    expect(formatUpdateError({ code: "NETWORK" })).toBe('{"code":"NETWORK"}');
    expect(formatUpdateError(null)).toBe("未知错误");
    expect(formatUpdateError("  ")).toBe("未知错误");
  });
});
