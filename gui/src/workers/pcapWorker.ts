import { analyzePcap } from "../lib/pcapAnalyzer";
import type { PcapWorkerRequest, PcapWorkerResponse } from "../lib/pcapWorkerClient";

interface WorkerScope {
  onmessage: ((event: MessageEvent<PcapWorkerRequest>) => void) | null;
  postMessage(message: PcapWorkerResponse): void;
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
    const report = analyzePcap(request.bytes);
    if (cancelled.has(request.jobId)) scope.postMessage({ type: "cancelled", jobId: request.jobId });
    else scope.postMessage({ type: "complete", jobId: request.jobId, report });
  } catch (error) {
    scope.postMessage({ type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : String(error) });
  } finally {
    cancelled.delete(request.jobId);
  }
};
