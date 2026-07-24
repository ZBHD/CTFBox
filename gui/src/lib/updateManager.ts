import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
import {
  check as tauriCheck,
  type DownloadEvent,
} from "@tauri-apps/plugin-updater";

export type { DownloadEvent } from "@tauri-apps/plugin-updater";

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

  constructor(cause: unknown) {
    super("更新已安装，但应用重启失败", { cause });
    this.name = "UpdateRelaunchError";
  }
}

const EMPTY_STATE: UpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};

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
  const check = options.check ?? tauriCheck;
  if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };

  if (!options.silent) {
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
    notify(options.onState, { ...EMPTY_STATE, phase: "checking" });
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
  }

  let update: UpdateHandle | null;
  try {
    update = await check();
  } catch (error) {
    if (options.signal?.aborted || options.silent) {
      return { state: { ...EMPTY_STATE } };
    }

    const state: UpdateState = {
      ...EMPTY_STATE,
      phase: "error",
      error: formatUpdateError(error),
    };
    if (options.signal?.aborted) return { state: { ...EMPTY_STATE } };
    notify(options.onState, state);
    return { state };
  }

  if (options.signal?.aborted) {
    if (update) await closeDiscardedUpdate(update);
    return { state: { ...EMPTY_STATE } };
  }

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
  let notificationFailed = false;
  let notificationError: unknown;
  let resolveFinished!: () => void;
  let rejectFinished!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
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
      notificationFailed = true;
      notificationError = error;
      acceptingEvents = false;
      rejectFinished(error);
      return;
    }

    if (event.event === "Finished") {
      acceptingEvents = false;
      resolveFinished();
    }
  };

  let downloadFailed = false;
  let downloadError: unknown;
  try {
    await Promise.all([update.download(onEvent), finished]);
  } catch (error) {
    acceptingEvents = false;
    if (notificationFailed) throw notificationError;
    downloadFailed = true;
    downloadError = error;
  }

  if (downloadFailed) {
    state = {
      ...state,
      phase: "error",
      error: formatUpdateError(downloadError),
    };
    notify(onState, state);
    return { state, update };
  }

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
