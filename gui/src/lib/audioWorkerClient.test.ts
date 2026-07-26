import { describe, expect, it, vi } from "vitest";
import type { AudioAnalysisInput } from "./audioStego";
import { DEFAULT_AUDIO_OPTIONS, type AudioReport } from "./audioTypes";
import type { AudioWorkerLike, AudioWorkerRequest, AudioWorkerResponse } from "./audioWorkerClient";
import { AudioWorkerClient } from "./audioWorkerClient";

class FakeWorker implements AudioWorkerLike {
  requests: Array<{ message: AudioWorkerRequest; transfer?: Transferable[] }> = [];
  listeners = new Set<(event: MessageEvent<AudioWorkerResponse>) => void>();
  errorListeners = new Set<(event: ErrorEvent) => void>();
  terminated = false;
  postMessage(message: AudioWorkerRequest, transfer?: Transferable[]) { this.requests.push({ message, transfer }); }
  addEventListener(type: "message", listener: (event: MessageEvent<AudioWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<AudioWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.add(listener as (event: MessageEvent<AudioWorkerResponse>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }
  removeEventListener(type: "message", listener: (event: MessageEvent<AudioWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<AudioWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.delete(listener as (event: MessageEvent<AudioWorkerResponse>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }
  terminate() { this.terminated = true; }
  emit(response: AudioWorkerResponse) { for (const listener of this.listeners) listener({ data: response } as MessageEvent<AudioWorkerResponse>); }
  emitError(message: string) { for (const listener of this.errorListeners) listener({ message } as ErrorEvent); }
}

function input(): AudioAnalysisInput {
  return {
    fileName: "a.wav",
    bytes: Uint8Array.of(1, 2, 3, 4),
    pcm: { sampleRate: 8000, bitDepth: 16, lossy: false, channels: [Int32Array.of(1, 2, 3, 4)] },
    options: { ...DEFAULT_AUDIO_OPTIONS },
    prefixes: ["flag"],
    caseSensitive: false,
  };
}

const REPORT: AudioReport = {
  track: { format: "WAV", sampleRate: 8000, channels: 1, bitDepth: 16, durationSeconds: 0, lossy: false },
  findings: [], visuals: [], strings: [], metadata: [], carvedFiles: [],
};

describe("AudioWorkerClient", () => {
  it("transfers cloned buffers and resolves progress then report", async () => {
    const worker = new FakeWorker();
    const client = new AudioWorkerClient(() => worker);
    const progress = vi.fn();
    const original = input();
    const pending = client.analyze(original, progress);
    const request = worker.requests[0];
    expect(request.message.type).toBe("analyze");
    expect(request.transfer).toHaveLength(2); // bytes + 1 声道
    if (request.message.type !== "analyze") throw new Error("unexpected request");
    expect(request.message.input.bytes).not.toBe(original.bytes);
    expect(original.bytes).toEqual(Uint8Array.of(1, 2, 3, 4));
    worker.emit({ type: "progress", jobId: request.message.jobId, progress: { stage: "lsb", completed: 1, total: 3 } });
    worker.emit({ type: "complete", jobId: request.message.jobId, report: REPORT });
    await expect(pending).resolves.toMatchObject({ track: { format: "WAV" } });
    expect(progress).toHaveBeenCalledOnce();
  });

  it("cancels the previous job when a new analysis starts", async () => {
    const worker = new FakeWorker();
    const client = new AudioWorkerClient(() => worker);
    const first = client.analyze(input());
    const second = client.analyze(input());
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.requests.some(({ message }) => message.type === "cancel" && message.jobId === 1)).toBe(true);
    worker.emit({ type: "error", jobId: 2, message: "boom" });
    await expect(second).rejects.toThrow("boom");
  });

  it("recreates the worker after a crash", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const client = new AudioWorkerClient(() => workers.shift()!);
    const pending = client.analyze(input());
    first.emitError("worker crashed");
    await expect(pending).rejects.toThrow("worker crashed");
    expect(first.terminated).toBe(true);
    const retry = client.analyze(input());
    const request = second.requests[0].message;
    if (request.type !== "analyze") throw new Error("unexpected request");
    second.emit({ type: "complete", jobId: request.jobId, report: REPORT });
    await expect(retry).resolves.toMatchObject({ track: { channels: 1 } });
  });
});
