import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STEGO_OPTIONS } from "./stegoAnalyzer";
import type { StegoWorkerLike, StegoWorkerRequest, StegoWorkerResponse } from "./stegoWorkerClient";
import { StegoWorkerClient } from "./stegoWorkerClient";

class FakeWorker implements StegoWorkerLike {
  requests: Array<{ message: StegoWorkerRequest; transfer?: Transferable[] }> = [];
  listeners = new Set<(event: MessageEvent<StegoWorkerResponse>) => void>();
  errorListeners = new Set<(event: ErrorEvent) => void>();
  terminated = false;
  postMessage(message: StegoWorkerRequest, transfer?: Transferable[]) { this.requests.push({ message, transfer }); }
  addEventListener(type: "message", listener: (event: MessageEvent<StegoWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<StegoWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.add(listener as (event: MessageEvent<StegoWorkerResponse>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }
  removeEventListener(type: "message", listener: (event: MessageEvent<StegoWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<StegoWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.delete(listener as (event: MessageEvent<StegoWorkerResponse>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }
  terminate() { this.terminated = true; }
  emit(response: StegoWorkerResponse) { for (const listener of this.listeners) listener({ data: response } as MessageEvent<StegoWorkerResponse>); }
  emitError(message: string) { for (const listener of this.errorListeners) listener({ message } as ErrorEvent); }
}

function input() {
  return {
    fileName: "sample.png",
    bytes: Uint8Array.of(1, 2, 3),
    pixels: { width: 1, height: 1, rgba: Uint8Array.of(4, 5, 6, 255) },
    prefixes: ["ctfshow"],
    caseSensitive: false,
  };
}

describe("StegoWorkerClient", () => {
  it("transfers cloned source buffers and resolves progress/results", async () => {
    const worker = new FakeWorker();
    const client = new StegoWorkerClient(() => worker);
    const progress = vi.fn();
    const original = input();
    const pending = client.analyze(original, DEFAULT_STEGO_OPTIONS, progress);
    const request = worker.requests[0];
    expect(request.message.type).toBe("analyze");
    expect(request.transfer).toHaveLength(2);
    if (request.message.type !== "analyze") throw new Error("unexpected request");
    expect(request.message.input.bytes).not.toBe(original.bytes);
    expect(original.bytes).toEqual(Uint8Array.of(1, 2, 3));
    worker.emit({ type: "progress", jobId: request.message.jobId, progress: { stage: "structure", completed: 0, total: 1 } });
    worker.emit({ type: "complete", jobId: request.message.jobId, report: { format: "PNG", findings: [], sections: [], metadata: [], strings: [], visuals: [], carvedFiles: [] } });
    await expect(pending).resolves.toMatchObject({ format: "PNG" });
    expect(progress).toHaveBeenCalledOnce();
  });

  it("rejects the previous job when a new analysis starts", async () => {
    const worker = new FakeWorker();
    const client = new StegoWorkerClient(() => worker);
    const first = client.analyze(input(), DEFAULT_STEGO_OPTIONS);
    const second = client.analyze(input(), DEFAULT_STEGO_OPTIONS);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.requests.some(({ message }) => message.type === "cancel" && message.jobId === 1)).toBe(true);
    worker.emit({ type: "error", jobId: 2, message: "failed" });
    await expect(second).rejects.toThrow("failed");
  });

  it("terminates and rejects active work on dispose", async () => {
    const worker = new FakeWorker();
    const client = new StegoWorkerClient(() => worker);
    const pending = client.analyze(input(), DEFAULT_STEGO_OPTIONS);
    client.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("rejects a crashed worker and recreates it for a retry", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const client = new StegoWorkerClient(() => workers.shift()!);
    const pending = client.analyze(input(), DEFAULT_STEGO_OPTIONS);

    expect(first.errorListeners.size).toBe(1);
    first.emitError("worker crashed");
    await expect(pending).rejects.toThrow("worker crashed");
    expect(first.terminated).toBe(true);

    const retry = client.analyze(input(), DEFAULT_STEGO_OPTIONS);
    const request = second.requests[0].message;
    if (request.type !== "analyze") throw new Error("unexpected request");
    second.emit({ type: "error", jobId: request.jobId, message: "retry reached worker" });
    await expect(retry).rejects.toThrow("retry reached worker");
  });
});
