import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsPanel, type SettingsSection } from "./components/SettingsPanel";
import { FlagHitStrip } from "./components/FlagHitStrip";
import { ToolRail, type ToolSelection } from "./components/ToolRail";
import { UpdateReadyDialog } from "./components/UpdateReadyDialog";
import { CryptoWorkbench } from "./components/processing/CryptoWorkbench";
import { MiscWorkbench } from "./components/processing/MiscWorkbench";
import { CommandTerminal } from "./components/workbench/CommandTerminal";
import { AutomationControls, type AutomationPhase } from "./components/workbench/AutomationControls";
import { ModeControls } from "./components/workbench/ModeControls";
import { ParameterPanel } from "./components/workbench/ParameterPanel";
import { ResultsPanel } from "./components/workbench/ResultsPanel";
import { buildCommand, type ToolParameters } from "./lib/commandBuilder";
import {
  loadFlagPrefixPreference,
  saveFlagPrefixPreference,
} from "./lib/flagPrefixPreference";
import {
  loadFlagSettingsPreference,
  saveFlagSettingsPreference,
  type FlagSettings,
} from "./lib/flagSettingsPreference";
import type { LocalAnalysisState } from "./lib/lsbTypes";
import { getPlugin } from "./lib/pluginRegistry";
import { createToolRunRequest } from "./lib/runnerProtocol";
import { StreamEventBatcher } from "./lib/streamEventBatcher";
import { TaskFlagScanner } from "./lib/taskFlagScanner";
import { applySuggestionPatch, buildTaskSuggestions, type TaskSuggestion } from "./lib/suggestionEngine";
import { buildAutomationJobs, type AutomationJob } from "./lib/automationEngine";
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

const IDLE_UPDATE_STATE: UpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};

interface AutomationState {
  phase: AutomationPhase;
  concurrency: number;
  started: number;
}

const IDLE_AUTOMATION: AutomationState = { phase: "idle", concurrency: 3, started: 0 };

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
  image: "图片/文件隐写",
  audio: "音频隐写",
};

function selectionKey(selection: ToolSelection) {
  return `${selection.toolId}:${selection.mode ?? "default"}`;
}

interface AppProps {
  updateAdapter?: AppUpdateAdapter;
}

function App({ updateAdapter = DEFAULT_UPDATE_ADAPTER }: AppProps) {
  const flagScannerRef = useRef(new TaskFlagScanner());
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
  const [flagSettings, setFlagSettings] = useState<FlagSettings>(() =>
    loadFlagSettingsPreference(loadFlagPrefixPreference()));
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [tasks, setTasks] = useState<Record<string, TaskState>>({
    "sqlmap:default": createTask("sqlmap"),
  });
  const [automations, setAutomations] = useState<Record<string, AutomationState>>({});
  const mountedRef = useRef(false);
  const updateStateRef = useRef(updateState);
  const updateHandleRef = useRef<UpdateHandle | null>(null);
  const checkControllerRef = useRef<AbortController | null>(null);
  const checkSequenceRef = useRef(0);
  const downloadBusyRef = useRef(false);
  const restartBusyRef = useRef(false);
  const installedRef = useRef(false);
  const linkSequenceRef = useRef(0);
  const automationJobsRef = useRef<Record<string, Set<string>>>({});
  const streamEventBatcherRef = useRef<StreamEventBatcher<ToolStreamEvent>>();
  streamEventBatcherRef.current ??= new StreamEventBatcher((events) => {
    setTasks((current) => events.reduce((next, event) => updateTaskContainingRun(
      next,
      event.runId,
      (owner) => applyToolStreamEvent(owner, event),
    ), current));
  });

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

  useEffect(() => () => streamEventBatcherRef.current?.dispose(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveFlagPrefixPreference(flagSettings.prefixes);
    saveFlagSettingsPreference(flagSettings);
  }, [flagSettings]);

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
    setLinkError(undefined);
    void Promise.resolve().then(() => updateAdapter.openUrl(url)).then(() => {
      if (mountedRef.current && linkSequenceRef.current === sequence) setLinkError(undefined);
    }).catch((error) => {
      if (!mountedRef.current || linkSequenceRef.current !== sequence) return;
      setLinkError(`打开链接失败：${formatUpdateError(error)}`);
    });
  };

  const key = selectionKey(selection);
  const task = tasks[key] ?? createTask(selection.toolId);
  const automation = automations[key] ?? IDLE_AUTOMATION;
  const plugin = getPlugin(selection.toolId) ?? getPlugin("sqlmap")!;
  const isWebTool = plugin.category === "web" && plugin.runner !== undefined;
  const command = useMemo(
    () => isWebTool ? buildCommand(selection.toolId, task.edition, task.parameters as ToolParameters) : [],
    [isWebTool, selection.toolId, task.edition, task.parameters],
  );
  const suggestions = useMemo(() => buildTaskSuggestions(
    selection.toolId,
    task.parameters as ToolParameters,
    task.findings,
  ).map((suggestion) => {
    const snapshot = applySuggestionPatch(selection.toolId, task.parameters as ToolParameters, suggestion.patch);
    return {
      ...suggestion,
      commandPreview: buildCommand(selection.toolId, task.edition, snapshot).join(" "),
    };
  }), [selection.toolId, task.edition, task.findings, task.parameters]);
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

  const updateLocalAnalysis = (analysis: LocalAnalysisState) => {
    updateCurrentTask((current) => ({ ...current, localAnalysis: analysis }));
  };

  const runWithTaskParameters = useCallback((taskKey: string, taskSnapshot: TaskState, parameters: ToolParameters, automationJob?: AutomationJob) => {
    if (!getPlugin(taskSnapshot.toolId)?.runner) return;
    if (!automationJob && taskSnapshot.status === "running") return;
    const nextCommand = buildCommand(taskSnapshot.toolId, taskSnapshot.edition, parameters);
    if (nextCommand.length <= 1) return;
    const id = `run-${crypto.randomUUID()}`;
    let request;
    try {
      request = createToolRunRequest(id, taskSnapshot.toolId, taskSnapshot.edition, nextCommand);
    } catch (error) {
      setTasks((current) => {
        const owner = current[taskKey] ?? createTask(taskSnapshot.toolId);
        const failed = appendRun(owner, {
          id,
          argv: nextCommand,
          status: "running",
          output: error instanceof Error ? error.message : "命令无效",
          collapsed: false,
        });
        return { ...current, [taskKey]: finishRun(failed, id, "failed") };
      });
      return;
    }
    setTasks((current) => {
      const owner = current[taskKey] ?? createTask(taskSnapshot.toolId);
      return {
        ...current,
        [taskKey]: appendRun(owner, {
          id,
          argv: nextCommand,
          status: "running",
          output: `命令已启动：${nextCommand.join(" ")}\n`,
          collapsed: false,
          automationJobId: automationJob?.id,
          automationLabel: automationJob?.label,
        }),
      };
    });
    const onEvent = new Channel<ToolStreamEvent>();
    onEvent.onmessage = (event) => {
      streamEventBatcherRef.current?.push(event);
    };
    void invoke("run_tool", { request, onEvent }).catch((error) => {
      setTasks((current) => updateTaskContainingRun(current, id, (owner) =>
        finishRun(appendOutput(owner, id, `\n执行失败：${error instanceof Error ? error.message : String(error)}\n`), id, "failed"),
      ));
    });
  }, []);

  const runWithParameters = (parameters: ToolParameters, automationJob?: AutomationJob) => {
    runWithTaskParameters(key, task, parameters, automationJob);
  };

  const runCommand = () => {
    if (task.status === "running") {
      if (automation.phase === "running") {
        automationJobsRef.current[key]?.clear();
        setAutomations((current) => ({ ...current, [key]: { ...(current[key] ?? IDLE_AUTOMATION), phase: "stopped" } }));
      }
      for (const activeRun of task.runs.filter((run) => run.status === "running")) {
        void invoke("stop_tool", { runId: activeRun.id }).catch((error) => {
          setTasks((current) => updateTaskContainingRun(current, activeRun.id, (owner) =>
            appendOutput(owner, activeRun.id, `\n停止失败：${error instanceof Error ? error.message : String(error)}\n`),
          ));
        });
      }
      return;
    }
    runWithParameters(task.parameters as ToolParameters);
  };

  const applyAndRunSuggestion = (suggestion: TaskSuggestion) => {
    if (task.status === "running") return;
    const snapshot = applySuggestionPatch(selection.toolId, task.parameters as ToolParameters, suggestion.patch);
    updateCurrentTask((current) => ({ ...current, parameters: snapshot }));
    runWithParameters(snapshot);
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
    automationJobsRef.current[taskKey]?.clear();
    setAutomations((current) => ({ ...current, [taskKey]: { ...(current[taskKey] ?? IDLE_AUTOMATION), phase: "stopped", started: 0 } }));
    const activeRuns = task.runs.filter((run) => run.status === "running");
    const clear = () => setTasks((current) => {
      const currentTask = current[taskKey];
      return currentTask ? { ...current, [taskKey]: clearTask(currentTask) } : current;
    });
    if (activeRuns.length === 0) {
      clear();
      return;
    }
    void Promise.all(activeRuns.map((run) => invoke("stop_tool", { runId: run.id })))
      .then(clear)
      .catch((error) => setTasks((current) => activeRuns.reduce((next, run) => updateTaskContainingRun(next, run.id, (owner) =>
        appendOutput(owner, run.id, `\n清空前停止失败：${error instanceof Error ? error.message : String(error)}\n`),
      ), current)));
  };

  const toggleRun = (runId: string) => {
    updateCurrentTask((current) => ({
      ...current,
      runs: current.runs.map((run) => run.id === runId ? { ...run, collapsed: !run.collapsed } : run),
    }));
  };

  const prefixes = flagSettings.prefixes.enabled;
  const flagHits = useMemo(
    () => flagScannerRef.current.scan(key, task, flagSettings, prefixes),
    [flagSettings, key, prefixes, task],
  );
  const activeAutomationRuns = task.runs.filter((run) => run.status === "running" && run.automationJobId).length;
  const updateAutomation = (updater: (current: AutomationState) => AutomationState) => {
    setAutomations((current) => ({ ...current, [key]: updater(current[key] ?? IDLE_AUTOMATION) }));
  };
  const stopAutomationForTask = useCallback((taskKey: string, taskSnapshot: TaskState, phase: AutomationPhase = "stopped") => {
    automationJobsRef.current[taskKey]?.clear();
    setAutomations((current) => ({ ...current, [taskKey]: { ...(current[taskKey] ?? IDLE_AUTOMATION), phase } }));
    for (const run of taskSnapshot.runs.filter((item) => item.status === "running" && item.automationJobId)) {
      void invoke("stop_tool", { runId: run.id }).catch(() => undefined);
    }
  }, []);
  const stopAutomation = () => {
    stopAutomationForTask(key, task);
  };
  const startAutomation = () => {
    if (!canRun || task.runs.some((run) => run.status === "running")) return;
    automationJobsRef.current[key] = new Set();
    updateAutomation((current) => ({ ...current, phase: "running", started: 0 }));
  };

  useEffect(() => {
    for (const [taskKey, automationState] of Object.entries(automations)) {
      if (automationState.phase !== "running") continue;
      const taskSnapshot = tasks[taskKey];
      if (!taskSnapshot || getPlugin(taskSnapshot.toolId)?.category !== "web" || !getPlugin(taskSnapshot.toolId)?.runner) continue;
      if (flagSettings.pauseOnMatch && flagScannerRef.current.scan(taskKey, taskSnapshot, flagSettings, prefixes).length > 0) {
        stopAutomationForTask(taskKey, taskSnapshot, "flag-found");
        continue;
      }
      const started = automationJobsRef.current[taskKey] ?? new Set<string>();
      automationJobsRef.current[taskKey] = started;
      const jobs = buildAutomationJobs(taskSnapshot.toolId, taskSnapshot.parameters as ToolParameters, taskSnapshot.findings, prefixes);
      const pending = jobs.filter((job) => !started.has(job.id));
      const active = taskSnapshot.runs.filter((run) => run.status === "running" && run.automationJobId).length;
      const capacity = Math.max(0, automationState.concurrency - active);
      if (capacity > 0 && pending.length > 0) {
        const next = pending.slice(0, capacity);
        next.forEach((job) => started.add(job.id));
        setAutomations((current) => ({ ...current, [taskKey]: { ...(current[taskKey] ?? IDLE_AUTOMATION), started: started.size } }));
        next.forEach((job) => runWithTaskParameters(taskKey, taskSnapshot, job.parameters, job));
        continue;
      }
      if (active === 0 && pending.length === 0) {
        const failed = [...started].some((jobId) => {
          const latestRun = taskSnapshot.runs.slice().reverse().find((run) => run.automationJobId === jobId);
          return latestRun?.status === "failed";
        });
        setAutomations((current) => ({
          ...current,
          [taskKey]: { ...(current[taskKey] ?? IDLE_AUTOMATION), phase: failed ? "failed" : "completed" },
        }));
      }
    }
  }, [automations, flagSettings, prefixes, runWithTaskParameters, stopAutomationForTask, tasks]);
  const railProps = {
    selection,
    settingsOpen,
    onSelect: selectTool,
    onOpenSettings: () => setSettingsOpen(true),
  };
  const availableUpdateVersion = updateHandle && updateState.latestVersion
    && ["available", "downloading", "ready", "error"].includes(updateState.phase)
    ? updateState.latestVersion
    : undefined;
  const restartDialogOpen = updateHandle !== null
    && updateState.phase === "ready"
    && !restartDialogPostponed;

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
          currentVersion={health?.version}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          updateState={updateState}
          onCheckUpdate={() => { void runUpdateCheck(false); }}
          onStartUpdate={startUpdateDownload}
          onRestartUpdate={restartIntoUpdate}
          onOpenGitHub={() => openExternalUrl(GITHUB_URL)}
          onOpenReleaseNotes={() => openExternalUrl(RELEASE_NOTES_URL)}
          restartBusy={restartBusy}
          restartError={restartDialogOpen ? undefined : restartError}
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
          {isWebTool && <AutomationControls
            phase={automation.phase}
            concurrency={automation.concurrency}
            active={activeAutomationRuns}
            started={automation.started}
            onConcurrencyChange={(concurrency) => updateAutomation((current) => ({ ...current, concurrency }))}
            onStart={startAutomation}
            onStop={stopAutomation}
          />}
          {isWebTool ? <div className="web-workspace-grid">
            <div className="web-output-stack">
              <CommandTerminal runs={task.runs} commandPreview={command.join(" ")} onToggleRun={toggleRun} flagHits={flagHits} runningRunId={task.runs.find((run) => run.status === "running")?.id} onSendInput={(input) => { const run = task.runs.find((item) => item.status === "running"); if (run) sendToolInput(run.id, input); }} />
              <ResultsPanel findings={task.findings} suggestions={suggestions} running={task.status === "running"} onApplySuggestion={applyAndRunSuggestion} flagEnabled={flagSettings.enabled} flagPrefixes={prefixes} flagHits={flagHits} />
            </div>
            <ParameterPanel toolId={selection.toolId} parameters={task.parameters as ToolParameters} findings={task.findings} onChange={updateParameter} />
          </div> : selection.toolId === "crypto" ?
            <CryptoWorkbench mode={selection.mode ?? "encoding"} parameters={task.parameters as ToolParameters} flagPrefixes={prefixes} flagCaseSensitive={flagSettings.caseSensitive} flagEnabled={flagSettings.enabled} onChange={updateParameter} onClear={() => updateCurrentTask(clearTask)} /> :
            <MiscWorkbench mode={selection.mode ?? "image"} parameters={task.parameters as ToolParameters} analysis={task.localAnalysis} flagPrefixes={prefixes} flagCaseSensitive={flagSettings.caseSensitive} flagEnabled={flagSettings.enabled} onChange={updateParameter} onAnalysisChange={updateLocalAnalysis} onClear={() => updateCurrentTask(clearTask)} />}
          {!isWebTool && <FlagHitStrip hits={flagHits} />}
          <footer className="statusbar">
            <span className={health ? "status-dot status-dot-ok" : "status-dot"} />
            <span>{health ? `${health.app} ${health.version} · ${health.platform}` : healthError ? "浏览器预览模式" : "正在连接后端"}</span>
            <span className="status-spacer" />
            <span>{task.runs.length} 次运行</span>
          </footer>
        </main>
      )}
      {restartDialogOpen && updateHandle && (
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
