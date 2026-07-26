import { describe, expect, it } from "vitest";
import { DEFAULT_LSB_PARAMETERS } from "./lsbEngine";
import {
  LsbWorkerClient,
  type LsbWorkerLike,
  type LsbWorkerRequest,
  type LsbWorkerResponse,
} from "./lsbWorkerClient";
import type { LsbCandidate, LsbImageSource } from "./lsbTypes";

class FakeWorker implements LsbWorkerLike {
  messages: Array<{ message: LsbWorkerRequest; transfer?: Transferable[] }> = [];
  listeners = new Set<(event: MessageEvent<LsbWorkerResponse>) => void>();
  errorListeners = new Set<(event: ErrorEvent) => void>();
  terminated = false;

  postMessage(message: LsbWorkerRequest, transfer?: Transferable[]) {
    this.messages.push({ message, transfer });
  }

  addEventListener(type: "message", listener: (event: MessageEvent<LsbWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<LsbWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.add(listener as (event: MessageEvent<LsbWorkerResponse>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: "message", listener: (event: MessageEvent<LsbWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<LsbWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.delete(listener as (event: MessageEvent<LsbWorkerResponse>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: LsbWorkerResponse) {
    for (const listener of this.listeners) listener({ data } as MessageEvent<LsbWorkerResponse>);
  }

  emitError(message: string) {
    for (const listener of this.errorListeners) listener({ message } as ErrorEvent);
  }
}

const source: LsbImageSource = {
  width: 2,
  height: 1,
  rgba: Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]),
  paletteIndices: Uint8Array.from([1, 0]),
};

const candidate: LsbCandidate = {
  id: "candidate",
  score: 100,
  parameters: DEFAULT_LSB_PARAMETERS,
  preview: "ctfshow{worker}",
  mediaType: "text/plain",
  evidence: ["发现 Flag：ctfshow{worker}"],
  bytes: new TextEncoder().encode("ctfshow{worker}"),
  files: [],
};

describe("LSB worker client", () => {
  it("transfers cloned source buffers and resolves automatic candidates", async () => {
    const worker = new FakeWorker();
    const progress: number[] = [];
    const client = new LsbWorkerClient(() => worker);
    const pending = client.auto(source, {
      depth: "quick",
      prefixes: ["ctfshow"],
      caseSensitive: false,
      onProgress: (value) => progress.push(value.tested),
    });
    const request = worker.messages[0].message;

    expect(request.type).toBe("auto");
    expect(worker.messages[0].transfer).toHaveLength(2);
    expect(source.rgba.byteLength).toBe(8);
    worker.emit({ type: "progress", jobId: request.jobId, progress: { stage: "presets", tested: 1, total: 2, elapsedMs: 3 } });
    worker.emit({ type: "complete", jobId: request.jobId, candidates: [candidate] });

    await expect(pending).resolves.toEqual([candidate]);
    expect(progress).toEqual([1]);
  });

  it("runs manual extraction through the same worker", async () => {
    const worker = new FakeWorker();
    const client = new LsbWorkerClient(() => worker);
    const pending = client.manual(source, DEFAULT_LSB_PARAMETERS);
    const request = worker.messages[0].message;

    expect(request.type).toBe("manual");
    worker.emit({ type: "manual-complete", jobId: request.jobId, candidate });
    await expect(pending).resolves.toEqual(candidate);
  });

  it("cancels active work and rejects when the worker confirms cancellation", async () => {
    const worker = new FakeWorker();
    const client = new LsbWorkerClient(() => worker);
    const pending = client.auto(source, { depth: "deep", prefixes: [], caseSensitive: false });
    const jobId = worker.messages[0].message.jobId;

    client.cancel();
    expect(worker.messages.at(-1)?.message).toEqual({ type: "cancel", jobId });
    expect(worker.listeners.size).toBe(0);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ignores late messages after a job has settled", async () => {
    const worker = new FakeWorker();
    const client = new LsbWorkerClient(() => worker);
    const pending = client.auto(source, { depth: "quick", prefixes: [], caseSensitive: false });
    const jobId = worker.messages[0].message.jobId;

    worker.emit({ type: "complete", jobId, candidates: [] });
    await expect(pending).resolves.toEqual([]);
    worker.emit({ type: "error", jobId, message: "late" });
    expect(worker.listeners.size).toBe(0);
  });

  it("terminates the worker and rejects pending work on disposal", async () => {
    const worker = new FakeWorker();
    const client = new LsbWorkerClient(() => worker);
    const pending = client.auto(source, { depth: "quick", prefixes: [], caseSensitive: false });

    client.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("rejects a crashed worker and recreates it for the next analysis", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const client = new LsbWorkerClient(() => workers.shift()!);
    const pending = client.auto(source, { depth: "quick", prefixes: [], caseSensitive: false });

    expect(first.errorListeners.size).toBe(1);
    first.emitError("worker crashed");
    await expect(pending).rejects.toThrow("worker crashed");
    expect(first.terminated).toBe(true);

    const retry = client.auto(source, { depth: "quick", prefixes: [], caseSensitive: false });
    const jobId = second.messages[0].message.jobId;
    second.emit({ type: "complete", jobId, candidates: [] });
    await expect(retry).resolves.toEqual([]);
  });
});
