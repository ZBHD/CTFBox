import { autoSearchLsb } from "../lib/lsbAutoSearch";
import { extractLsb } from "../lib/lsbEngine";
import { scoreLsbPayload } from "../lib/lsbFormats";
import type { LsbCandidate } from "../lib/lsbTypes";
import type { LsbWorkerRequest, LsbWorkerResponse } from "../lib/lsbWorkerClient";

interface WorkerScope {
  onmessage: ((event: MessageEvent<LsbWorkerRequest>) => void) | null;
  postMessage(message: LsbWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;
const controllers = new Map<number, AbortController>();

function send(message: LsbWorkerResponse) {
  scope.postMessage(message);
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    controllers.get(request.jobId)?.abort();
    return;
  }

  if (request.type === "manual") {
    try {
      const bytes = extractLsb(request.source, request.parameters);
      const scored = scoreLsbPayload(bytes, request.prefixes, request.caseSensitive);
      const candidate: LsbCandidate = {
        id: `manual-${request.jobId}`,
        score: scored.score,
        parameters: request.parameters,
        preview: scored.preview,
        mediaType: scored.mediaType,
        evidence: scored.evidence,
        bytes,
        files: scored.files,
      };
      send({ type: "manual-complete", jobId: request.jobId, candidate });
    } catch (error) {
      send({ type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const controller = new AbortController();
  controllers.set(request.jobId, controller);
  void autoSearchLsb(request.source, {
    depth: request.depth,
    prefixes: request.prefixes,
    caseSensitive: request.caseSensitive,
    signal: controller.signal,
    onProgress: (progress) => send({ type: "progress", jobId: request.jobId, progress }),
  }).then((candidates) => {
    send({ type: "complete", jobId: request.jobId, candidates });
  }).catch((error) => {
    if (error instanceof Error && error.name === "AbortError") send({ type: "cancelled", jobId: request.jobId });
    else send({ type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : String(error) });
  }).finally(() => {
    controllers.delete(request.jobId);
  });
};
