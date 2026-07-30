import { describe, expect, it } from "vitest";
import type { PcapReport } from "./pcapAnalyzer";
import type { PcapWorkerLike, PcapWorkerRequest, PcapWorkerResponse } from "./pcapWorkerClient";
import { PcapWorkerClient } from "./pcapWorkerClient";

class FakeWorker implements PcapWorkerLike {
  requests: Array<{ message: PcapWorkerRequest; transfer?: Transferable[] }> = [];
  listeners = new Set<(event: MessageEvent<PcapWorkerResponse>) => void>();
  errorListeners = new Set<(event: ErrorEvent) => void>();
  terminated = false;

  postMessage(message: PcapWorkerRequest, transfer?: Transferable[]) { this.requests.push({ message, transfer }); }
  addEventListener(type: "message", listener: (event: MessageEvent<PcapWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<PcapWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.add(listener as (event: MessageEvent<PcapWorkerResponse>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }
  removeEventListener(type: "message", listener: (event: MessageEvent<PcapWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<PcapWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.listeners.delete(listener as (event: MessageEvent<PcapWorkerResponse>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }
  terminate() { this.terminated = true; }
  emit(response: PcapWorkerResponse) { for (const listener of this.listeners) listener({ data: response } as MessageEvent<PcapWorkerResponse>); }
}

const report: PcapReport = { format: "pcap", linkType: 1, packets: [], findings: [] };

describe("PcapWorkerClient", () => {
  it("transfers a cloned capture buffer and resolves its report", async () => {
    const worker = new FakeWorker();
    const client = new PcapWorkerClient(() => worker);
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const pending = client.analyze(bytes);
    const request = worker.requests[0];

    expect(request.message.type).toBe("analyze");
    expect(request.transfer).toHaveLength(1);
    if (request.message.type !== "analyze") throw new Error("unexpected request");
    expect(request.message.bytes).not.toBe(bytes);
    expect(bytes).toEqual(Uint8Array.of(1, 2, 3, 4));
    worker.emit({ type: "complete", jobId: request.message.jobId, report });

    await expect(pending).resolves.toEqual(report);
  });

  it("cancels an unfinished analysis before starting a new job", async () => {
    const worker = new FakeWorker();
    const client = new PcapWorkerClient(() => worker);
    const first = client.analyze(Uint8Array.of(1));
    const second = client.analyze(Uint8Array.of(2));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.requests.some(({ message }) => message.type === "cancel" && message.jobId === 1)).toBe(true);
    const request = worker.requests[2]?.message;
    if (!request || request.type !== "analyze") throw new Error("second request was not queued");
    worker.emit({ type: "complete", jobId: request.jobId, report });
    await expect(second).resolves.toEqual(report);
  });
});
