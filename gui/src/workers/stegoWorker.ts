import { analyzeStego } from "../lib/stegoAnalyzer";
import type { LsbExtractedFile } from "../lib/lsbTypes";
import type { StegoWorkerRequest, StegoWorkerResponse } from "../lib/stegoWorkerClient";

interface WorkerScope {
  onmessage: ((event: MessageEvent<StegoWorkerRequest>) => void) | null;
  postMessage(message: StegoWorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const controllers = new Map<number, AbortController>();

function fileBuffers(files: LsbExtractedFile[], output: Set<ArrayBuffer>) {
  for (const file of files) {
    if (file.bytes.buffer instanceof ArrayBuffer) output.add(file.bytes.buffer);
    if (file.children) fileBuffers(file.children, output);
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    controllers.get(request.jobId)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(request.jobId, controller);
  void analyzeStego(request.input, request.options, {
    signal: controller.signal,
    onProgress: (progress) => scope.postMessage({ type: "progress", jobId: request.jobId, progress }),
  }).then((report) => {
    const buffers = new Set<ArrayBuffer>();
    for (const visual of report.visuals) if (visual.pixels.buffer instanceof ArrayBuffer) buffers.add(visual.pixels.buffer);
    fileBuffers(report.carvedFiles, buffers);
    scope.postMessage({ type: "complete", jobId: request.jobId, report }, [...buffers]);
  }).catch((error) => {
    if (error instanceof Error && error.name === "AbortError") scope.postMessage({ type: "cancelled", jobId: request.jobId });
    else scope.postMessage({ type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : String(error) });
  }).finally(() => controllers.delete(request.jobId));
};
