import type { AudioAnalysisInput } from "./audioStego";
import type { AudioProgress, AudioReport } from "./audioTypes";

export type AudioWorkerRequest =
  | { type: "analyze"; jobId: number; input: AudioAnalysisInput }
  | { type: "cancel"; jobId: number };

export type AudioWorkerResponse =
  | { type: "progress"; jobId: number; progress: AudioProgress }
  | { type: "complete"; jobId: number; report: AudioReport }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string };

export interface AudioWorkerLike {
  postMessage(message: AudioWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<AudioWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<AudioWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface ActiveJob {
  jobId: number;
  listener: (event: MessageEvent<AudioWorkerResponse>) => void;
  errorListener: (event: ErrorEvent) => void;
  reject: (error: Error) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function cloneInput(input: AudioAnalysisInput): AudioAnalysisInput {
  return {
    ...input,
    bytes: input.bytes.slice(),
    prefixes: input.prefixes ? [...input.prefixes] : undefined,
    options: { ...input.options },
    pcm: { ...input.pcm, channels: input.pcm.channels.map((channel) => channel.slice()) },
  };
}

export class AudioWorkerClient {
  private worker: AudioWorkerLike;
  private readonly factory: () => AudioWorkerLike;
  private active?: ActiveJob;
  private nextJobId = 1;
  private disposed = false;

  constructor(factory: () => AudioWorkerLike = () => new Worker(
    new URL("../workers/audioWorker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as AudioWorkerLike) {
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

  analyze(input: AudioAnalysisInput, onProgress?: (progress: AudioProgress) => void) {
    if (this.disposed) return Promise.reject(new Error("音频分析 Worker 已释放"));
    this.replaceActive();
    const jobId = this.nextJobId++;
    const cloned = cloneInput(input);
    return new Promise<AudioReport>((resolve, reject) => {
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
        reject(new Error(`音频分析 Worker 异常：${event.message || "未知错误"}`));
      };
      const listener = (event: MessageEvent<AudioWorkerResponse>) => {
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
      const transfer: Transferable[] = [cloned.bytes.buffer as ArrayBuffer, ...cloned.pcm.channels.map((channel) => channel.buffer as ArrayBuffer)];
      this.worker.postMessage({ type: "analyze", jobId, input: cloned }, transfer);
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
