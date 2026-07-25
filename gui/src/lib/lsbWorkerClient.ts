import type {
  LsbCandidate,
  LsbExtractionParameters,
  LsbImageSource,
  LsbProgress,
} from "./lsbTypes";

export type LsbWorkerRequest =
  | { type: "auto"; jobId: number; source: LsbImageSource; depth: "quick" | "deep"; prefixes: string[]; caseSensitive: boolean }
  | { type: "manual"; jobId: number; source: LsbImageSource; parameters: LsbExtractionParameters }
  | { type: "cancel"; jobId: number };

export type LsbWorkerResponse =
  | { type: "progress"; jobId: number; progress: LsbProgress }
  | { type: "complete"; jobId: number; candidates: LsbCandidate[] }
  | { type: "manual-complete"; jobId: number; candidate: LsbCandidate }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string };

export interface LsbWorkerLike {
  postMessage(message: LsbWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<LsbWorkerResponse>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<LsbWorkerResponse>) => void): void;
  terminate(): void;
}

interface SearchOptions {
  depth: "quick" | "deep";
  prefixes: readonly string[];
  caseSensitive: boolean;
  onProgress?: (progress: LsbProgress) => void;
}

interface ActiveJob {
  jobId: number;
  listener: (event: MessageEvent<LsbWorkerResponse>) => void;
  reject: (error: Error) => void;
}

function abortError() {
  const error = new Error("分析已取消");
  error.name = "AbortError";
  return error;
}

function cloneSource(source: LsbImageSource) {
  return {
    source: {
      width: source.width,
      height: source.height,
      rgba: source.rgba.slice(),
      paletteIndices: source.paletteIndices?.slice(),
    },
  };
}

export class LsbWorkerClient {
  private readonly worker: LsbWorkerLike;
  private active?: ActiveJob;
  private nextJobId = 1;
  private disposed = false;

  constructor(factory: () => LsbWorkerLike = () => new Worker(
    new URL("../workers/lsbWorker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as LsbWorkerLike) {
    this.worker = factory();
  }

  private replaceActive() {
    if (!this.active) return;
    this.worker.postMessage({ type: "cancel", jobId: this.active.jobId });
    this.worker.removeEventListener("message", this.active.listener);
    this.active.reject(abortError());
    this.active = undefined;
  }

  private start<T>(
    buildRequest: (jobId: number, source: LsbImageSource) => LsbWorkerRequest,
    source: LsbImageSource,
    resolveResponse: (response: LsbWorkerResponse) => T | undefined,
    onProgress?: (progress: LsbProgress) => void,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("LSB Worker 已释放"));
    this.replaceActive();
    const jobId = this.nextJobId++;
    const cloned = cloneSource(source).source;

    return new Promise<T>((resolve, reject) => {
      const settle = () => {
        this.worker.removeEventListener("message", listener);
        if (this.active?.jobId === jobId) this.active = undefined;
      };
      const listener = (event: MessageEvent<LsbWorkerResponse>) => {
        const response = event.data;
        if (response.jobId !== jobId) return;
        if (response.type === "progress") {
          onProgress?.(response.progress);
          return;
        }
        if (response.type === "cancelled") {
          settle();
          reject(abortError());
          return;
        }
        if (response.type === "error") {
          settle();
          reject(new Error(response.message));
          return;
        }
        const value = resolveResponse(response);
        if (value === undefined) return;
        settle();
        resolve(value);
      };
      this.active = { jobId, listener, reject };
      this.worker.addEventListener("message", listener);
      const transfer = [cloned.rgba.buffer];
      if (cloned.paletteIndices) transfer.push(cloned.paletteIndices.buffer);
      this.worker.postMessage(buildRequest(jobId, cloned), transfer as Transferable[]);
    });
  }

  auto(source: LsbImageSource, options: SearchOptions) {
    return this.start<LsbCandidate[]>(
      (jobId, cloned) => ({
        type: "auto",
        jobId,
        source: cloned,
        depth: options.depth,
        prefixes: [...options.prefixes],
        caseSensitive: options.caseSensitive,
      }),
      source,
      (response) => response.type === "complete" ? response.candidates : undefined,
      options.onProgress,
    );
  }

  manual(source: LsbImageSource, parameters: LsbExtractionParameters) {
    return this.start<LsbCandidate>(
      (jobId, cloned) => ({ type: "manual", jobId, source: cloned, parameters }),
      source,
      (response) => response.type === "manual-complete" ? response.candidate : undefined,
    );
  }

  cancel() {
    if (this.active) this.worker.postMessage({ type: "cancel", jobId: this.active.jobId });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      this.worker.removeEventListener("message", this.active.listener);
      this.active.reject(abortError());
      this.active = undefined;
    }
    this.worker.terminate();
  }
}
