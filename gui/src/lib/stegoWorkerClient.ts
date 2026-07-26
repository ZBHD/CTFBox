import type { StegoAnalysisInput } from "./stegoAnalyzer";
import type { StegoOptions, StegoProgress, StegoReport } from "./stegoTypes";

export type StegoWorkerRequest =
  | { type: "analyze"; jobId: number; input: StegoAnalysisInput; options: StegoOptions }
  | { type: "cancel"; jobId: number };

export type StegoWorkerResponse =
  | { type: "progress"; jobId: number; progress: StegoProgress }
  | { type: "complete"; jobId: number; report: StegoReport }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string };

export interface StegoWorkerLike {
  postMessage(message: StegoWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<StegoWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<StegoWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface ActiveJob {
  jobId: number;
  listener: (event: MessageEvent<StegoWorkerResponse>) => void;
  errorListener: (event: ErrorEvent) => void;
  reject: (error: Error) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function cloneInput(input: StegoAnalysisInput): StegoAnalysisInput {
  return {
    ...input,
    prefixes: input.prefixes ? [...input.prefixes] : undefined,
    bytes: input.bytes.slice(),
    pixels: input.pixels ? { ...input.pixels, rgba: input.pixels.rgba.slice() } : undefined,
  };
}

export class StegoWorkerClient {
  private worker: StegoWorkerLike;
  private readonly factory: () => StegoWorkerLike;
  private active?: ActiveJob;
  private nextJobId = 1;
  private disposed = false;

  constructor(factory: () => StegoWorkerLike = () => new Worker(
    new URL("../workers/stegoWorker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as StegoWorkerLike) {
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

  analyze(input: StegoAnalysisInput, options: StegoOptions, onProgress?: (progress: StegoProgress) => void) {
    if (this.disposed) return Promise.reject(new Error("隐写分析 Worker 已释放"));
    this.replaceActive();
    const jobId = this.nextJobId++;
    const cloned = cloneInput(input);
    return new Promise<StegoReport>((resolve, reject) => {
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
        reject(new Error(`隐写分析 Worker 异常：${event.message || "未知错误"}`));
      };
      const listener = (event: MessageEvent<StegoWorkerResponse>) => {
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
      const transfer: Transferable[] = [cloned.bytes.buffer as ArrayBuffer];
      if (cloned.pixels) transfer.push(cloned.pixels.rgba.buffer as ArrayBuffer);
      this.worker.postMessage({ type: "analyze", jobId, input: cloned, options: { ...options } }, transfer);
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
