import type { PcapReport } from "./pcapAnalyzer";

export type PcapWorkerRequest =
  | { type: "analyze"; jobId: number; bytes: Uint8Array }
  | { type: "cancel"; jobId: number };

export type PcapWorkerResponse =
  | { type: "complete"; jobId: number; report: PcapReport }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string };

export interface PcapWorkerLike {
  postMessage(message: PcapWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PcapWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<PcapWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface ActiveJob {
  jobId: number;
  listener: (event: MessageEvent<PcapWorkerResponse>) => void;
  errorListener: (event: ErrorEvent) => void;
  reject: (error: Error) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

export class PcapWorkerClient {
  private worker: PcapWorkerLike;
  private readonly factory: () => PcapWorkerLike;
  private active?: ActiveJob;
  private nextJobId = 1;
  private disposed = false;

  constructor(factory: () => PcapWorkerLike = () => new Worker(
    new URL("../workers/pcapWorker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as PcapWorkerLike) {
    this.factory = factory;
    this.worker = this.factory();
  }

  private replaceActive() {
    if (!this.active) return;
    this.worker.postMessage({ type: "cancel", jobId: this.active.jobId });
    this.worker.removeEventListener("message", this.active.listener);
    this.worker.removeEventListener("error", this.active.errorListener);
    this.active.reject(abortError());
    this.active = undefined;
  }

  analyze(bytes: Uint8Array) {
    if (this.disposed) return Promise.reject(new Error("PCAP 分析 Worker 已释放"));
    this.replaceActive();
    const jobId = this.nextJobId++;
    const cloned = bytes.slice();
    return new Promise<PcapReport>((resolve, reject) => {
      const settle = () => {
        this.worker.removeEventListener("message", listener);
        this.worker.removeEventListener("error", errorListener);
        if (this.active?.jobId === jobId) this.active = undefined;
      };
      const errorListener = (event: ErrorEvent) => {
        settle();
        const failedWorker = this.worker;
        failedWorker.terminate();
        if (!this.disposed) this.worker = this.factory();
        reject(new Error(`PCAP 分析 Worker 异常：${event.message || "未知错误"}`));
      };
      const listener = (event: MessageEvent<PcapWorkerResponse>) => {
        const response = event.data;
        if (response.jobId !== jobId) return;
        settle();
        if (response.type === "complete") resolve(response.report);
        else if (response.type === "cancelled") reject(abortError());
        else reject(new Error(response.message));
      };
      this.active = { jobId, listener, errorListener, reject };
      this.worker.addEventListener("message", listener);
      this.worker.addEventListener("error", errorListener);
      this.worker.postMessage({ type: "analyze", jobId, bytes: cloned }, [cloned.buffer as ArrayBuffer]);
    });
  }

  cancel() {
    this.replaceActive();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      this.worker.removeEventListener("message", this.active.listener);
      this.worker.removeEventListener("error", this.active.errorListener);
      this.active.reject(abortError());
      this.active = undefined;
    }
    this.worker.terminate();
  }
}
