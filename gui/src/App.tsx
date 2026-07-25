import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsPanel, type FlagSettings, type SettingsSection } from "./components/SettingsPanel";
import { FlagHitStrip } from "./components/FlagHitStrip";
import { ToolRail, type ToolSelection } from "./components/ToolRail";
import { UpdateReadyDialog } from "./components/UpdateReadyDialog";
import { CryptoWorkbench } from "./components/processing/CryptoWorkbench";
import { MiscWorkbench } from "./components/processing/MiscWorkbench";
import { CommandTerminal } from "./components/workbench/CommandTerminal";
import { ModeControls } from "./components/workbench/ModeControls";
import { ParameterPanel } from "./components/workbench/ParameterPanel";
import { ResultsPanel } from "./components/workbench/ResultsPanel";
import { buildCommand, type ToolParameters } from "./lib/commandBuilder";
import { detectFlags } from "./lib/flagDetector";
import { DEFAULT_FLAG_PREFIXES, loadFlagPrefixes, saveFlagPrefixes } from "./lib/flagPrefixPreference";
import { getPlugin } from "./lib/pluginRegistry";
import { createToolRunRequest } from "./lib/runnerProtocol";
import { loadTheme, saveTheme, type Theme } from "./lib/themePreference";
import {
  checkLatest,
  downloadUpdate,
  formatUpdateError,
  installAndRelaunch,
  UpdateRelaunchError,
  type CheckLatestOptions,
  type InstallOptions,
  type UpdateHandle,
  type UpdateResult,
  type UpdateState,
} from "./lib/updateManager";
import { applyToolStreamEvent, appendOutput, appendRun, clearTask, createTask, finishRun, updateTaskContainingRun, type TaskState, type ToolStreamEvent } from "./state/taskStore";

interface HealthStatus {
  app: string;
  version: string;
  platform: string;
}

const DEFAULT_FLAG_SETTINGS: FlagSettings = {
  enabled: true,
  prefixes: DEFAULT_FLAG_PREFIXES,
  scanOutput: true,
  scanStructured: true,
  scanBase64: true,
  caseSensitive: false,
  pauseOnMatch: false,
};

const IDLE_UPDATE_STATE: UpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};

const GITHUB_URL = "https://github.com/ZBHD/CTFBox";
const RELEASE_NOTES_URL = `${GITHUB_URL}/releases/latest`;

export interface AppUpdateAdapter {
  checkLatest(options?: CheckLatestOptions): Promise<UpdateResult>;
  downloadUpdate(
    update: UpdateHandle,
    previousState: UpdateState,
    onState?: (state: UpdateState) => void,
  ): Promise<UpdateResult>;
  installAndRelaunch(update: UpdateHandle, options?: InstallOptions): Promise<void>;
  relaunch(): Promise<void>;
  openUrl(url: string): Promise<void>;
}

const DEFAULT_UPDATE_ADAPTER: AppUpdateAdapter = {
  checkLatest,
  downloadUpdate,
  installAndRelaunch,
  relaunch: tauriRelaunch,
  openUrl: tauriOpenUrl,
};

const MODE_NAMES: Record<string, string> = {
  encoding: "编码转换",
  hash: "哈希识别",
  xor: "异或分析",
  "fake-encryption": "伪加密",
  lsb: "LSB 隐写",
  image: "图片隐写",
  audio: "音频隐写",
};

function selectionKey(selection: ToolSelection) {
  return `${selection.toolId}:${selection.mode ?? "default"}`;
}

interface AppProps {
  updateAdapter?: AppUpdateAdapter;
}

function App({ updateAdapter = DEFAULT_UPDATE_ADAPTER }: AppProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [selection, setSelection] = useState<ToolSelection>({ toolId: "sqlmap" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("flags");
  const [updateState, setUpdateState] = useState<UpdateState>(IDLE_UPDATE_STATE);
  const [updateHandle, setUpdateHandle] = useState<UpdateHandle | null>(null);
  const [restartDialogPostponed, setRestartDialogPostponed] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartError, setRestartError] = useState<string>();
  const [linkError, setLinkError] = useState<string>();
  const [flagSettings, setFlagSettings] = useState<FlagSettings>(() => ({
    ...DEFAULT_FLAG_SETTINGS,
    prefixes: loadFlagPrefixes(),
  }));
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [tasks, setTasks] = useState<Record<string, TaskState>>({
    "sqlmap:default": createTask("sqlmap"),
  });
  const mountedRef = useRef(false);
  const updateStateRef = useRef(updateState);
  const updateHandleRef = useRef<UpdateHandle | null>(null);
  const checkControllerRef = useRef<AbortController | null>(null);
  const checkSequenceRef = useRef(0);
  const downloadBusyRef = useRef(false);
  const restartBusyRef = useRef(false);
  const installedRef = useRef(false);
  const linkSequenceRef = useRef(0);

  const commitUpdateState = useCallback((state: UpdateState) => {
    updateStateRef.current = state;
    setUpdateState(state);
  }, []);

  const closeUpdateHandle = useCallback((handle: UpdateHandle | null) => {
    if (!handle) return;
    void Promise.resolve().then(() => handle.close()).catch(() => undefined);
  }, []);

  const adoptUpdateHandle = useCallback((nextHandle: UpdateHandle | null) => {
    const previousHandle = updateHandleRef.current;
    if (previousHandle === nextHandle) return;
    updateHandleRef.current = nextHandle;
    setUpdateHandle(nextHandle);
    closeUpdateHandle(previousHandle);
  }, [closeUpdateHandle]);

  const runUpdateCheck = useCallback(async (silent: boolean) => {
    if (!silent && ["downloading", "ready"].includes(updateStateRef.current.phase)) return;

    checkControllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++checkSequenceRef.current;
    checkControllerRef.current = controller;

    if (!silent) {
      commitUpdateState({ ...IDLE_UPDATE_STATE, phase: "checking" });
    }

    const isCurrent = () => (
      mountedRef.current
      && !controller.signal.aborted
      && checkSequenceRef.current === sequence
    );

    try {
      const result = await updateAdapter.checkLatest({
        silent,
        signal: controller.signal,
        onState: (state) => {
          if (isCurrent()) commitUpdateState(state);
        },
      });

      if (!isCurrent()) {
        if (result.update && result.update !== updateHandleRef.current) closeUpdateHandle(result.update);
        return;
      }

      commitUpdateState(result.state);
      adoptUpdateHandle(result.update ?? null);
      if (result.update) {
        installedRef.current = false;
        setRestartError(undefined);
        setRestartDialogPostponed(false);
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (!silent) adoptUpdateHandle(null);
      commitUpdateState(silent
        ? { ...IDLE_UPDATE_STATE }
        : { ...IDLE_UPDATE_STATE, phase: "error", error: formatUpdateError(error) });
    } finally {
      if (checkControllerRef.current === controller) checkControllerRef.current = null;
    }
  }, [adoptUpdateHandle, closeUpdateHandle, commitUpdateState, updateAdapter]);

  useEffect(() => {
    mountedRef.current = true;
    void runUpdateCheck(true);

    return () => {
      mountedRef.current = false;
      checkSequenceRef.current += 1;
      checkControllerRef.current?.abort();
      checkControllerRef.current = null;
      const ownedHandle = updateHandleRef.current;
      updateHandleRef.current = null;
      closeUpdateHandle(ownedHandle);
    };
  }, [closeUpdateHandle, runUpdateCheck]);

  useEffect(() => {
    void invoke<HealthStatus>("app_health")
      .then(setHealth)
      .catch(() => setHealthError(true));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveFlagPrefixes(flagSettings.prefixes);
  }, [flagSettings.prefixes]);

  const startUpdateDownload = () => {
    const ownedHandle = updateHandleRef.current;
    if (!ownedHandle || downloadBusyRef.current || updateStateRef.current.phase === "downloading") return;
    downloadBusyRef.current = true;
    setRestartError(undefined);
    setRestartDialogPostponed(false);

    void Promise.resolve().then(() => updateAdapter.downloadUpdate(ownedHandle, updateStateRef.current, (state) => {
      if (!mountedRef.current || updateHandleRef.current !== ownedHandle) return;
      commitUpdateState(state);
      if (state.phase === "ready") setRestartDialogPostponed(false);
    })).then((result) => {
      if (!mountedRef.current || updateHandleRef.current !== ownedHandle) {
        if (result.update && result.update !== ownedHandle) closeUpdateHandle(result.update);
        return;
      }
      commitUpdateState(result.state);
      if (result.update !== ownedHandle) adoptUpdateHandle(result.update ?? null);
      if (result.state.phase === "ready") setRestartDialogPostponed(false);
    }).catch((error) => {
      if (!mountedRef.current || updateHandleRef.current !== ownedHandle) return;
      commitUpdateState({
        ...updateStateRef.current,
        phase: "error",
        error: formatUpdateError(error),
      });
    }).finally(() => {
      downloadBusyRef.current = false;
    });
  };

  const restartIntoUpdate = () => {
    const ownedHandle = updateHandleRef.current;
    if (!ownedHandle || restartBusyRef.current) return;
    restartBusyRef.current = true;
    setRestartBusy(true);
    setRestartError(undefined);

    const relaunchOnly = installedRef.current;
    const restart = Promise.resolve().then(() => relaunchOnly
      ? updateAdapter.relaunch()
      : updateAdapter.installAndRelaunch(ownedHandle, { relaunch: updateAdapter.relaunch }));

    void restart.then(() => {
      installedRef.current = true;
      if (mountedRef.current && updateHandleRef.current === ownedHandle) {
        setRestartError("更新已安装，但应用仍在运行，请再次重启");
      }
    }).catch((error) => {
      if (!mountedRef.current || updateHandleRef.current !== ownedHandle) return;
      if (error instanceof UpdateRelaunchError || installedRef.current) {
        installedRef.current = true;
        setRestartError(`重启应用失败：${formatUpdateError(error)}`);
        return;
      }
      setRestartError(`安装更新失败：${formatUpdateError(error)}`);
    }).finally(() => {
      restartBusyRef.current = false;
      if (mountedRef.current) setRestartBusy(false);
    });
  };

  const openExternalUrl = (url: string) => {
    const sequence = ++linkSequenceRef.current;
    void Promise.resolve().then(() => updateAdapter.openUrl(url)).then(() => {
      if (mountedRef.current && linkSequenceRef.current === sequence) setLinkError(undefined);
    }).catch((error) => {
      if (!mountedRef.current || linkSequenceRef.current !== sequence) return;
      setLinkError(`打开链接失败：${formatUpdateError(error)}`);
    });
  };

  const key = selectionKey(selection);
  const task = tasks[key] ?? createTask(selection.toolId);
  const plugin = getPlugin(selection.toolId) ?? getPlugin("sqlmap")!;
  const isWebTool = selection.toolId === "sqlmap" || selection.toolId === "sstimap";
  const command = useMemo(
    () => isWebTool ? buildCommand(selection.toolId, task.edition, task.parameters as ToolParameters) : [],
    [isWebTool, selection.toolId, task.edition, task.parameters],
  );
  const canRun = isWebTool && command.length > 1;

  const updateCurrentTask = (updater: (current: TaskState) => TaskState) => {
    setTasks((current) => ({ ...current, [key]: updater(current[key] ?? createTask(selection.toolId)) }));
  };

  const selectTool = (next: ToolSelection) => {
    setSelection(next);
    setSettingsOpen(false);
    const nextKey = selectionKey(next);
    setTasks((current) => current[nextKey] ? current : { ...current, [nextKey]: createTask(next.toolId) });
  };

  const updateParameter = (name: string, value: string | boolean) => {
    updateCurrentTask((current) => ({
      ...current,
      parameters: { ...current.parameters, [name]: value },
    }));
  };

  const runCommand = () => {
    if (task.status === "running") {
      const activeRun = task.runs.find((run) => run.status === "running");
      if (activeRun) {
        void invoke("stop_tool", { runId: activeRun.id }).catch((error) => {
          setTasks((current) => updateTaskContainingRun(current, activeRun.id, (owner) =>
            appendOutput(owner, activeRun.id, `\n停止失败：${error instanceof Error ? error.message : String(error)}\n`),
          ));
        });
      }
      return;
    }
    const id = `run-${crypto.randomUUID()}`;
    let request;
    try {
      request = createToolRunRequest(id, selection.toolId as "sqlmap" | "sstimap", task.edition, command);
    } catch (error) {
      updateCurrentTask((current) => ({ ...current, status: "failed", runs: [...current.runs, { id, argv: command, status: "failed", output: error instanceof Error ? error.message : "命令无效", collapsed: false }] }));
      return;
    }
    updateCurrentTask((current) => {
      return appendRun(current, {
        id,
        argv: command,
        status: "running",
        output: `命令已启动：${command.join(" ")}\n`,
        collapsed: false,
      });
    });
    const onEvent = new Channel<ToolStreamEvent>();
    onEvent.onmessage = (event) => {
      setTasks((current) => Object.fromEntries(Object.entries(current).map(([taskKey, state]) => [
        taskKey,
        applyToolStreamEvent(state, event),
      ])));
    };
    void invoke("run_tool", { request, onEvent }).catch((error) => {
      setTasks((current) => updateTaskContainingRun(current, id, (owner) =>
        finishRun(appendOutput(owner, id, `\n执行失败：${error instanceof Error ? error.message : String(error)}\n`), id, "failed"),
      ));
    });
  };

  const sendToolInput = (runId: string, input: string) => {
    void invoke("send_tool_input", { runId, input }).catch((error) => {
      setTasks((current) => updateTaskContainingRun(current, runId, (owner) =>
        appendOutput(owner, runId, `\n发送输入失败：${error instanceof Error ? error.message : String(error)}\n`),
      ));
    });
  };

  const clearCurrentTask = () => {
    const taskKey = key;
    const activeRun = task.runs.find((run) => run.status === "running");
    const clear = () => setTasks((current) => {
      const currentTask = current[taskKey];
      return currentTask ? { ...current, [taskKey]: clearTask(currentTask) } : current;
    });
    if (!activeRun) {
      clear();
      return;
    }
    void invoke("stop_tool", { runId: activeRun.id })
      .then(clear)
      .catch((error) => {
        setTasks((current) => updateTaskContainingRun(current, activeRun.id, (owner) =>
          appendOutput(owner, activeRun.id, `\n清空前停止失败：${error instanceof Error ? error.message : String(error)}\n`),
        ));
      });
  };

  const toggleRun = (runId: string) => {
    updateCurrentTask((current) => ({
      ...current,
      runs: current.runs.map((run) => run.id === runId ? { ...run, collapsed: !run.collapsed } : run),
    }));
  };

  const prefixes = flagSettings.prefixes.split(",").map((item) => item.trim()).filter(Boolean);
  const flagScanText = [
    flagSettings.scanOutput ? task.runs.map((run) => run.output).join("\n") : "",
    flagSettings.scanStructured ? task.findings.map((finding) => finding.value).join("\n") : "",
    String(task.parameters.output ?? ""),
  ].join("\n");
  const flagHits = flagSettings.enabled
    ? detectFlags(flagScanText, prefixes, flagSettings.caseSensitive).filter((hit) => flagSettings.scanBase64 || hit.source !== "base64")
    : [];
  const railProps = {
    selection,
    settingsOpen,
    onSelect: selectTool,
    onOpenSettings: () => setSettingsOpen(true),
  };
  const availableUpdateVersion = updateState.latestVersion && ["available", "downloading", "ready"].includes(updateState.phase)
    ? updateState.latestVersion
    : undefined;

  return (
    <div className="app-shell">
      {availableUpdateVersion !== undefined ? (
        <ToolRail
          {...railProps}
          availableUpdateVersion={availableUpdateVersion}
          onOpenUpdate={() => {
            setSettingsSection("updates");
            setSettingsOpen(true);
          }}
        />
      ) : <ToolRail {...railProps} />}
      {settingsOpen ? (
        <SettingsPanel
          value={flagSettings}
          theme={theme}
          onChange={setFlagSettings}
          onThemeChange={setTheme}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          updateState={updateState}
          onCheckUpdate={() => { void runUpdateCheck(false); }}
          onStartUpdate={startUpdateDownload}
          onRestartUpdate={restartIntoUpdate}
          onOpenGitHub={() => openExternalUrl(GITHUB_URL)}
          onOpenReleaseNotes={() => openExternalUrl(RELEASE_NOTES_URL)}
          restartBusy={restartBusy}
          restartError={restartError}
          restartActionLabel={installedRef.current ? "再次重启" : restartError ? "重试安装" : "立即重启"}
          linkError={linkError}
        />
      ) : (
        <main className="main-content">
          <ModeControls
            plugin={plugin}
            modeLabel={selection.mode ? MODE_NAMES[selection.mode] : undefined}
            edition={task.edition}
            running={task.status === "running"}
            canRun={canRun}
            executionControls={isWebTool}
            onEditionChange={(edition) => updateCurrentTask((current) => ({ ...current, edition }))}
            onRun={runCommand}
            onClear={clearCurrentTask}
          />
          {isWebTool ? <div className="web-workspace-grid">
            <div className="web-output-stack">
              <CommandTerminal runs={task.runs} commandPreview={command.join(" ")} onToggleRun={toggleRun} flagHits={flagHits} runningRunId={task.runs.find((run) => run.status === "running")?.id} onSendInput={(input) => { const run = task.runs.find((item) => item.status === "running"); if (run) sendToolInput(run.id, input); }} />
              <ResultsPanel findings={task.findings} suggestions={task.suggestions} flagEnabled={flagSettings.enabled} flagPrefixes={prefixes} flagHits={flagHits} />
            </div>
            <ParameterPanel toolId={selection.toolId} parameters={task.parameters as ToolParameters} findings={task.findings} onChange={updateParameter} />
          </div> : selection.toolId === "crypto" ?
            <CryptoWorkbench mode={selection.mode ?? "encoding"} parameters={task.parameters as ToolParameters} flagPrefixes={prefixes} flagCaseSensitive={flagSettings.caseSensitive} flagEnabled={flagSettings.enabled} onChange={updateParameter} onClear={() => updateCurrentTask(clearTask)} /> :
            <MiscWorkbench mode={selection.mode ?? "image"} parameters={task.parameters as ToolParameters} onChange={updateParameter} onClear={() => updateCurrentTask(clearTask)} />}
          {!isWebTool && <FlagHitStrip hits={flagHits} />}
          <footer className="statusbar">
            <span className={health ? "status-dot status-dot-ok" : "status-dot"} />
            <span>{health ? `${health.app} ${health.version} · ${health.platform}` : healthError ? "浏览器预览模式" : "正在连接后端"}</span>
            <span className="status-spacer" />
            <span>{task.runs.length} 次运行</span>
          </footer>
        </main>
      )}
      {updateHandle && updateState.phase === "ready" && !restartDialogPostponed && (
        <UpdateReadyDialog
          version={updateState.latestVersion ?? updateHandle.version}
          busy={restartBusy}
          error={restartError}
          actionLabel={installedRef.current ? "再次重启" : restartError ? "重试安装" : "立即重启"}
          onPostpone={() => setRestartDialogPostponed(true)}
          onRestart={restartIntoUpdate}
        />
      )}
    </div>
  );
}

export default App;
