import type { ZipAnalysisInput } from "./zipEncryption";
import type { ZipProgress, ZipReport } from "./zipTypes";

export type ZipWorkerRequest =
  | { type: "analyze"; jobId: number; input: ZipAnalysisInput }
  | { type: "cancel"; jobId: number };

export type ZipWorkerResponse =
  | { type: "progress"; jobId: number; progress: ZipProgress }
  | { type: "complete"; jobId: number; report: ZipReport }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string };

export interface ZipWorkerLike {
  postMessage(message: ZipWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ZipWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<ZipWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface ActiveJob {
  jobId: number;
  listener: (event: MessageEvent<ZipWorkerResponse>) => void;
  errorListener: (event: ErrorEvent) => void;
  reject: (error: Error) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function cloneInput(input: ZipAnalysisInput): ZipAnalysisInput {
  return {
    bytes: input.bytes.slice(),
    options: { ...input.options },
    prefixes: input.prefixes ? [...input.prefixes] : [],
    caseSensitive: input.caseSensitive,
  };
}

export class ZipWorkerClient {
  private worker: ZipWorkerLike;
  private readonly factory: () => ZipWorkerLike;
  private active?: ActiveJob;
  private nextJobId = 1;
  private disposed = false;

  constructor(factory: () => ZipWorkerLike = () => new Worker(
    new URL("../workers/zipWorker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as ZipWorkerLike) {
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

  analyze(input: ZipAnalysisInput, onProgress?: (progress: ZipProgress) => void) {
    if (this.disposed) return Promise.reject(new Error("伪加密分析 Worker 已释放"));
    this.replaceActive();
    const jobId = this.nextJobId++;
    const cloned = cloneInput(input);
    return new Promise<ZipReport>((resolve, reject) => {
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
        reject(new Error(`伪加密分析 Worker 异常：${event.message || "未知错误"}`));
      };
      const listener = (event: MessageEvent<ZipWorkerResponse>) => {
        const response = event.data;
        if (response.jobId !== jobId) return;
        if (response.type === "progress") {
          onProgress?.(response.progress);
          return;
        }
        settle();
        if (response.type === "complete") resolve(response.report);
        else if (response.type === "cancelled") reject(abortError());
        else if (response.type === "error") reject(new Error(response.message));
      };
      this.active = { jobId, listener, errorListener, reject };
      this.worker.addEventListener("message", listener);
      this.worker.addEventListener("error", errorListener);
      this.worker.postMessage({ type: "analyze", jobId, input: cloned }, [cloned.bytes.buffer as ArrayBuffer]);
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
