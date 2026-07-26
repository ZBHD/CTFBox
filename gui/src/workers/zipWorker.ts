import { analyzeZip } from "../lib/zipEncryption";
import type { ZipWorkerRequest, ZipWorkerResponse } from "../lib/zipWorkerClient";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ZipWorkerRequest>) => void) | null;
  postMessage(message: ZipWorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const cancelled = new Set<number>();

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.jobId);
    return;
  }
  try {
    const report = analyzeZip(request.input, {
      onProgress: (progress) => {
        if (!cancelled.has(request.jobId)) scope.postMessage({ type: "progress", jobId: request.jobId, progress });
      },
    });
    if (cancelled.has(request.jobId)) scope.postMessage({ type: "cancelled", jobId: request.jobId });
    else scope.postMessage({ type: "complete", jobId: request.jobId, report });
  } catch (error) {
    scope.postMessage({ type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : String(error) });
  } finally {
    cancelled.delete(request.jobId);
  }
};
