import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { SettingsPanel, type FlagSettings } from "./components/SettingsPanel";
import { FlagHitStrip } from "./components/FlagHitStrip";
import { ToolRail, type ToolSelection } from "./components/ToolRail";
import { CryptoWorkbench } from "./components/processing/CryptoWorkbench";
import { MiscWorkbench } from "./components/processing/MiscWorkbench";
import { CommandTerminal } from "./components/workbench/CommandTerminal";
import { ModeControls } from "./components/workbench/ModeControls";
import { ParameterPanel } from "./components/workbench/ParameterPanel";
import { ResultsPanel } from "./components/workbench/ResultsPanel";
import { buildCommand, type ToolParameters } from "./lib/commandBuilder";
import { detectFlags } from "./lib/flagDetector";
import { getPlugin } from "./lib/pluginRegistry";
import { appendRun, clearTask, createTask, type TaskState } from "./state/taskStore";

interface HealthStatus {
  app: string;
  version: string;
  platform: string;
}

const DEFAULT_FLAG_SETTINGS: FlagSettings = {
  enabled: true,
  prefixes: "flag, CTF",
  scanOutput: true,
  scanStructured: true,
  scanBase64: true,
  caseSensitive: false,
  pauseOnMatch: false,
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

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [selection, setSelection] = useState<ToolSelection>({ toolId: "sqlmap" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flagSettings, setFlagSettings] = useState(DEFAULT_FLAG_SETTINGS);
  const [tasks, setTasks] = useState<Record<string, TaskState>>({
    "sqlmap:default": createTask("sqlmap"),
  });

  useEffect(() => {
    void invoke<HealthStatus>("app_health")
      .then(setHealth)
      .catch(() => setHealthError(true));
  }, []);

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
    const id = `run-${Date.now()}`;
    updateCurrentTask((current) => {
      const next = appendRun(current, {
        id,
        argv: command,
        status: "completed",
        output: `命令已编译：${command.join(" ")}\n桌面执行通道将在工具适配器接入后输出实时回显。`,
        collapsed: false,
      });
      return { ...next, status: "completed" };
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

  return (
    <div className="app-shell">
      <ToolRail selection={selection} settingsOpen={settingsOpen} onSelect={selectTool} onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen ? (
        <SettingsPanel value={flagSettings} onChange={setFlagSettings} />
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
            onClear={() => updateCurrentTask(clearTask)}
          />
          {isWebTool ? <div className="web-workspace-grid">
            <div className="web-output-stack">
              <CommandTerminal runs={task.runs} commandPreview={command.join(" ")} onToggleRun={toggleRun} flagHits={flagHits} />
              <ResultsPanel findings={task.findings} suggestions={task.suggestions} flagEnabled={flagSettings.enabled} flagPrefixes={prefixes} flagHits={flagHits} />
            </div>
            <ParameterPanel toolId={selection.toolId} parameters={task.parameters as ToolParameters} findings={task.findings} onChange={updateParameter} />
          </div> : selection.toolId === "crypto" ?
            <CryptoWorkbench mode={selection.mode ?? "encoding"} parameters={task.parameters as ToolParameters} onChange={updateParameter} onClear={() => updateCurrentTask(clearTask)} /> :
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
    </div>
  );
}

export default App;
