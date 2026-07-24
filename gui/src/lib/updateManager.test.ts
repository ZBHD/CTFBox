import { describe, expect, it, vi } from "vitest";
import {
  checkLatest,
  downloadUpdate,
  formatUpdateError,
  installAndRelaunch,
  type DownloadEvent,
  type UpdateHandle,
  type UpdateState,
} from "./updateManager";

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

  it("formats Error, string, structured unknown and empty values consistently", () => {
    expect(formatUpdateError(new Error("请求超时"))).toBe("请求超时");
    expect(formatUpdateError("签名无效")).toBe("签名无效");
    expect(formatUpdateError({ code: "NETWORK" })).toBe('{"code":"NETWORK"}');
    expect(formatUpdateError(null)).toBe("未知错误");
    expect(formatUpdateError("  ")).toBe("未知错误");
  });
});
