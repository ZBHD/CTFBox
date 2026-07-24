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
}

export interface InstallOptions {
  relaunch?: () => Promise<void>;
}

const EMPTY_STATE: UpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};

function notify(listener: StateListener | undefined, state: UpdateState) {
  listener?.({ ...state });
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
  notify(options.onState, { ...EMPTY_STATE, phase: "checking" });

  try {
    const update = await check();
    if (!update) {
      const state = { ...EMPTY_STATE, phase: "latest" } satisfies UpdateState;
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
    notify(options.onState, state);
    return { state, update };
  } catch (error) {
    const state: UpdateState = options.silent
      ? { ...EMPTY_STATE }
      : {
          ...EMPTY_STATE,
          phase: "error",
          error: formatUpdateError(error),
        };
    notify(options.onState, state);
    return { state };
  }
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

  try {
    await update.download((event) => {
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
      notify(onState, state);
    });

    state = { ...state, phase: "ready" };
    notify(onState, state);
    return { state, update };
  } catch (error) {
    state = {
      ...state,
      phase: "error",
      error: formatUpdateError(error),
    };
    notify(onState, state);
    return { state, update };
  }
}

export async function installAndRelaunch(
  update: UpdateHandle,
  options: InstallOptions = {},
): Promise<void> {
  await update.install();
  await (options.relaunch ?? tauriRelaunch)();
}
