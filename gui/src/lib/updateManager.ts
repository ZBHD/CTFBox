import { Channel, invoke } from "@tauri-apps/api/core";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";

export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type UpdatePhase =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion?: string;
  latestVersion?: string;
  date?: string;
  notes?: string;
  downloadedBytes: number;
  totalBytes?: number;
  error?: string;
}

export interface UpdateHandle {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  download(onEvent: (event: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}

export interface SetupUpdateMetadata {
  updateId: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

export interface SetupUpdateBackend {
  check(): Promise<SetupUpdateMetadata | null>;
  download(updateId: number, version: string, onEvent: (event: DownloadEvent) => void): Promise<void>;
  install(updateId: number, version: string): Promise<void>;
  discard(updateId: number, version: string): Promise<void>;
}

export interface UpdateResult {
  state: UpdateState;
  /** The caller owns this handle and closes it when the update workflow ends. */
  update?: UpdateHandle;
}

type CheckAdapter = () => Promise<UpdateHandle | null>;
type StateListener = (state: UpdateState) => void;

export interface CheckLatestOptions {
  silent?: boolean;
  check?: CheckAdapter;
  onState?: StateListener;
  signal?: AbortSignal;
}

export interface InstallOptions {
  relaunch?: () => Promise<void>;
}

export class UpdateRelaunchError extends Error {
  readonly installed = true;
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("更新已安装，但应用重启失败");
    this.name = "UpdateRelaunchError";
    this.cause = cause;
  }
}

const EMPTY_STATE: UpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};
const FINISHED_GRACE_MS = 1000;

const TAURI_SETUP_UPDATE_BACKEND: SetupUpdateBackend = {
  check: () => invoke<SetupUpdateMetadata | null>("check_setup_update"),
  download: async (updateId, version, onEvent) => {
    const channel = new Channel<DownloadEvent>();
    channel.onmessage = onEvent;
    await invoke("download_setup_update", { updateId, version, onEvent: channel });
  },
  install: (updateId, version) => invoke("install_setup_update", { updateId, version }),
  discard: (updateId, version) => invoke("discard_setup_update", { updateId, version }),
};

export function createSetupUpdateCheck(backend: SetupUpdateBackend): CheckAdapter {
  return async () => {
    const metadata = await backend.check();
    if (!metadata) return null;

    return {
      ...metadata,
      download: (onEvent) => backend.download(metadata.updateId, metadata.version, onEvent),
      install: () => backend.install(metadata.updateId, metadata.version),
      close: () => backend.discard(metadata.updateId, metadata.version),
    };
  };
}

const checkSetupUpdate = createSetupUpdateCheck(TAURI_SETUP_UPDATE_BACKEND);

type CheckOutcome =
  | { kind: "completed"; update: UpdateHandle | null }
  | { kind: "failed"; error: unknown }
  | { kind: "aborted" };

type DownloadOutcome =
  | { kind: "downloaded" }
  | { kind: "failed"; error: unknown }
  | { kind: "notification-failed"; error: unknown };

function notify(listener: StateListener | undefined, state: UpdateState) {
  listener?.({ ...state });
}

async function closeDiscardedUpdate(update: UpdateHandle): Promise<void> {
  try {
    await update.close();
  } catch {
    // Preserve the cancellation or listener error that caused the discard.
  }
}

function createAbortWait(signal: AbortSignal | undefined) {
  let abortListener: (() => void) | undefined;
  const promise = new Promise<CheckOutcome>((resolve) => {
    if (!signal) return;
    abortListener = () => { resolve({ kind: "aborted" }); };
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  });

  return {
    promise,
    dispose: () => {
      if (abortListener) signal?.removeEventListener("abort", abortListener);
    },
  };
}

async function waitForFinished(
  finished: Promise<void>,
  notificationFailure: Promise<DownloadOutcome>,
): Promise<DownloadOutcome | { kind: "finished" } | { kind: "timed-out" }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: "timed-out" }>((resolve) => {
    timeoutId = setTimeout(() => { resolve({ kind: "timed-out" }); }, FINISHED_GRACE_MS);
  });

  try {
    return await Promise.race([
      finished.then(() => ({ kind: "finished" }) as const),
      notificationFailure,
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function formatUpdateError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || "未知错误";
  }

  if (typeof error === "string") {
    return error.trim() || "未知错误";
  }

  if (error === null || error === undefined) {
    return "未知错误";
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error) || "未知错误";
  }
}

export async function checkLatest(
  options: CheckLatestOptions = {},
): Promise<UpdateResult> {
  const check = options.check ?? checkSetupUpdate;
  if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };

  if (!options.silent) {
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
    notify(options.onState, { ...EMPTY_STATE, phase: "checking" });
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
  }

  const abortWait = createAbortWait(options.signal);
  const checkOutcome = Promise.resolve()
    .then(() => check())
    .then<CheckOutcome, CheckOutcome>(
      async (update) => {
        if (options.signal?.aborted) {
          if (update) await closeDiscardedUpdate(update);
          return { kind: "aborted" };
        }
        return { kind: "completed", update };
      },
      (error) => options.signal?.aborted
        ? { kind: "aborted" }
        : { kind: "failed", error },
    );

  let outcome: CheckOutcome;
  try {
    outcome = await Promise.race([checkOutcome, abortWait.promise]);
  } finally {
    abortWait.dispose();
  }

  if (outcome.kind === "aborted") {
    return { state: { ...EMPTY_STATE } };
  }

  if (outcome.kind === "failed") {
    if (options.silent) return { state: { ...EMPTY_STATE } };

    const state: UpdateState = {
      ...EMPTY_STATE,
      phase: "error",
      error: formatUpdateError(outcome.error),
    };
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
    notify(options.onState, state);
    return { state };
  }

  const { update } = outcome;

  if (!update) {
    const state = { ...EMPTY_STATE, phase: "latest" } satisfies UpdateState;
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
    notify(options.onState, state);
    return { state };
  }

  const state: UpdateState = {
    phase: "available",
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    date: update.date,
    notes: update.body,
    downloadedBytes: 0,
  };
  if (options.signal?.aborted) {
    await closeDiscardedUpdate(update);
    return { state: { ...EMPTY_STATE } };
  }

  try {
    notify(options.onState, state);
  } catch (error) {
    await closeDiscardedUpdate(update);
    throw error;
  }
  return { state, update };
}

export async function downloadUpdate(
  update: UpdateHandle,
  previousState: UpdateState,
  onState?: StateListener,
): Promise<UpdateResult> {
  const { error: _previousError, ...metadata } = previousState;
  let state: UpdateState = {
    ...metadata,
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: undefined,
  };
  notify(onState, state);

  let acceptingEvents = true;
  let finishedReceived = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let resolveNotificationFailure!: (outcome: DownloadOutcome) => void;
  const notificationFailure = new Promise<DownloadOutcome>((resolve) => {
    resolveNotificationFailure = resolve;
  });

  const onEvent = (event: DownloadEvent) => {
    if (!acceptingEvents) return;

    if (event.event === "Started") {
      state = {
        ...state,
        totalBytes: event.data.contentLength,
      };
    } else if (event.event === "Progress") {
      state = {
        ...state,
        downloadedBytes: state.downloadedBytes + event.data.chunkLength,
      };
    }

    try {
      notify(onState, state);
    } catch (error) {
      acceptingEvents = false;
      resolveNotificationFailure({ kind: "notification-failed", error });
      return;
    }

    if (event.event === "Finished") {
      finishedReceived = true;
      acceptingEvents = false;
      resolveFinished();
    }
  };

  const downloadOutcome = Promise.resolve()
    .then(() => update.download(onEvent))
    .then<DownloadOutcome, DownloadOutcome>(
      () => ({ kind: "downloaded" }),
      (error) => ({ kind: "failed", error }),
    );
  let outcome = await Promise.race([downloadOutcome, notificationFailure]);

  if (outcome.kind === "notification-failed") {
    acceptingEvents = false;
    throw outcome.error;
  }

  if (outcome.kind === "failed") {
    acceptingEvents = false;
    state = {
      ...state,
      phase: "error",
      error: formatUpdateError(outcome.error),
    };
    notify(onState, state);
    return { state, update };
  }

  if (!finishedReceived) {
    const completion = await waitForFinished(finished, notificationFailure);
    if (completion.kind === "notification-failed") {
      acceptingEvents = false;
      throw completion.error;
    }
  }

  acceptingEvents = false;
  state = { ...state, phase: "ready" };
  notify(onState, state);
  return { state, update };
}

export async function installAndRelaunch(
  update: UpdateHandle,
  options: InstallOptions = {},
): Promise<void> {
  await update.install();
  try {
    await (options.relaunch ?? tauriRelaunch)();
  } catch (error) {
    throw new UpdateRelaunchError(error);
  }
}
