import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Flag,
  Github,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  SunMoon,
} from "lucide-react";
import { useState } from "react";
import { formatUpdateError, type UpdateState } from "../lib/updateManager";
import type { Theme } from "../lib/themePreference";

export interface FlagSettings {
  enabled: boolean;
  prefixes: string;
  scanOutput: boolean;
  scanStructured: boolean;
  scanBase64: boolean;
  caseSensitive: boolean;
  pauseOnMatch: boolean;
}

export type SettingsSection = "flags" | "appearance" | "updates";

interface BaseSettingsPanelProps {
  value: FlagSettings;
  theme: Theme;
  onChange: (value: FlagSettings) => void;
  onThemeChange: (theme: Theme) => void;
}

interface LegacySettingsPanelProps extends BaseSettingsPanelProps {
  section?: undefined;
  onSectionChange?: undefined;
  updateState?: undefined;
  onCheckUpdate?: undefined;
  onStartUpdate?: undefined;
  onOpenGitHub?: undefined;
  onOpenReleaseNotes?: undefined;
}

interface ControlledSettingsPanelProps extends BaseSettingsPanelProps {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  updateState: UpdateState;
  onCheckUpdate: () => void;
  onStartUpdate: () => void;
  onOpenGitHub: () => void;
  onOpenReleaseNotes: () => void;
}

type SettingsPanelProps = LegacySettingsPanelProps | ControlledSettingsPanelProps;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <button className={`toggle ${checked ? "toggle-on" : ""}`} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / (1024 ** unitIndex);
  const precision = Number.isInteger(scaled) || scaled >= 10 || unitIndex === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
}

function VersionValue({ label, version, accent = false }: { label: string; version?: string; accent?: boolean }) {
  return (
    <div className={`update-version-item ${accent ? "update-version-item-accent" : ""}`}>
      <span>{label}</span>
      <strong>{version ? `v${version}` : "--"}</strong>
    </div>
  );
}

function UpdateStatus({ state, onCheckUpdate, onStartUpdate }: {
  state: UpdateState;
  onCheckUpdate: () => void;
  onStartUpdate: () => void;
}) {
  const isChecking = state.phase === "checking";

  if (state.phase === "available") {
    return (
      <div className="update-status update-status-available">
        <div><Download size={18} /><span><strong>发现新版本</strong><small>安装包将在应用内下载并校验</small></span></div>
        <button className="update-primary-action" type="button" onClick={onStartUpdate}>
          更新到 v{state.latestVersion ?? "--"}
        </button>
      </div>
    );
  }

  if (state.phase === "downloading") {
    const hasTotal = typeof state.totalBytes === "number" && state.totalBytes > 0;
    const percentage = hasTotal
      ? Math.min(100, Math.max(0, Math.round((state.downloadedBytes / state.totalBytes!) * 100)))
      : undefined;
    const byteLabel = hasTotal
      ? `${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes!)}`
      : `${formatBytes(state.downloadedBytes)} 已下载`;

    return (
      <div className="update-status update-status-progress">
        <div className="update-progress-heading">
          <strong>正在下载更新</strong>
          <span>{percentage === undefined ? "计算进度中" : `${percentage}%`}</span>
        </div>
        <div
          className={`update-progress-track ${percentage === undefined ? "update-progress-indeterminate" : ""}`}
          role="progressbar"
          aria-label="更新下载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
          aria-valuetext={percentage === undefined ? byteLabel : undefined}
        >
          <span style={{ width: `${percentage ?? 24}%` }} />
        </div>
        <span className="update-progress-bytes">{byteLabel}</span>
      </div>
    );
  }

  if (state.phase === "ready") {
    return (
      <div className="update-status update-status-ready" role="status">
        <CheckCircle2 size={18} />
        <span><strong>更新已准备好</strong><small>安装包已下载并通过校验，可按提示重启应用</small></span>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="update-status update-status-error" role="alert">
        <div><AlertTriangle size={18} /><span><strong>检查更新失败</strong><small>{formatUpdateError(state.error)}</small></span></div>
        <button className="update-secondary-action" type="button" onClick={onCheckUpdate}>重试</button>
      </div>
    );
  }

  return (
    <div className="update-status update-status-quiet" role="status">
      <span>
        <strong>{isChecking ? "正在检查更新" : state.phase === "latest" ? "当前已是最新版本" : "按需检查新版本"}</strong>
        <small>{isChecking ? "正在连接 GitHub Release" : state.phase === "latest" ? "CTFBox 已运行最新稳定版本" : "仅获取最新稳定版，不包含预发布版本"}</small>
      </span>
      <button className="update-secondary-action" type="button" disabled={isChecking} onClick={onCheckUpdate}>
        <RefreshCw size={15} />{isChecking ? "正在检查" : "手动检查"}
      </button>
    </div>
  );
}

function UpdateSettings({ state, onCheckUpdate, onStartUpdate, onOpenGitHub, onOpenReleaseNotes }: {
  state: UpdateState;
  onCheckUpdate: () => void;
  onStartUpdate: () => void;
  onOpenGitHub: () => void;
  onOpenReleaseNotes: () => void;
}) {
  return (
    <section className="settings-section settings-updates" aria-labelledby="settings-updates-title" hidden={false}>
      <div className="settings-section-title update-section-title">
        <div>
          <h2 id="settings-updates-title">版本更新</h2>
          <p>检查并安装 CTFBox 的最新稳定版本</p>
        </div>
        <span className="update-channel">STABLE</span>
      </div>

      <div className="update-product">
        <div className="update-product-mark" aria-hidden="true">C</div>
        <div className="update-product-copy">
          <strong>CTFBox</strong>
          <span>一体化 CTF 工具箱</span>
        </div>
        <div className="update-version-grid">
          <VersionValue label="当前版本" version={state.currentVersion} />
          <VersionValue label="最新版本" version={state.latestVersion} accent={state.phase === "available"} />
        </div>
      </div>

      {state.date && (
        <div className="update-release-meta">
          <span>发布日期</span>
          <strong>{state.date}</strong>
        </div>
      )}

      {state.notes && (
        <div className="update-notes">
          <strong>本次更新</strong>
          <p>{state.notes}</p>
        </div>
      )}

      <UpdateStatus state={state} onCheckUpdate={onCheckUpdate} onStartUpdate={onStartUpdate} />

      <div className="update-links" aria-label="版本相关链接">
        <button type="button" onClick={onOpenGitHub}><Github size={15} />GitHub</button>
        <button type="button" onClick={onOpenReleaseNotes}><FileText size={15} />更新日志</button>
      </div>
    </section>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { value, theme, onChange, onThemeChange } = props;
  const [localSection, setLocalSection] = useState<"flags" | "appearance">("flags");
  const isControlled = props.section !== undefined;
  const section: SettingsSection = isControlled ? props.section : localSection;
  const selectSection = (nextSection: SettingsSection) => {
    if (isControlled) props.onSectionChange(nextSection);
    else if (nextSection !== "updates") setLocalSection(nextSection);
  };
  const update = <K extends keyof FlagSettings>(key: K, next: FlagSettings[K]) => onChange({ ...value, [key]: next });

  return (
    <main className="settings-page">
      <header className="settings-header">
        <div><span className="workspace-kicker">应用设置</span><h1>设置</h1><p>配置识别、外观和运行行为</p></div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          <button className={section === "flags" ? "active" : ""} type="button" aria-current={section === "flags" ? "page" : undefined} onClick={() => selectSection("flags")}><Flag size={15} />Flag 识别</button>
          <button className={section === "appearance" ? "active" : ""} type="button" aria-current={section === "appearance" ? "page" : undefined} onClick={() => selectSection("appearance")}><SunMoon size={15} />外观</button>
          {isControlled && (
            <button className={section === "updates" ? "active" : ""} type="button" aria-current={section === "updates" ? "page" : undefined} onClick={() => selectSection("updates")}><RefreshCw size={15} />版本更新</button>
          )}
          <button type="button" disabled><Settings2 size={15} />运行环境</button>
        </nav>

        <section className="settings-section" hidden={section !== "flags"}>
          <div className="settings-section-title"><div><h2>Flag 识别</h2><p>从终端回显和结构化结果中识别匹配字段</p></div><Toggle checked={value.enabled} onChange={(next) => update("enabled", next)} /></div>
          <div className="settings-row settings-row-field">
            <label htmlFor="flag-prefixes"><strong>检测头</strong><span>多个检测头使用英文逗号分隔</span></label>
            <input id="flag-prefixes" value={value.prefixes} onChange={(event) => update("prefixes", event.target.value)} placeholder="flag, CTF" />
          </div>
          <div className="settings-row"><div><strong>检测终端回显</strong><span>扫描每次运行产生的文本输出</span></div><Toggle checked={value.scanOutput} onChange={(next) => update("scanOutput", next)} /></div>
          <div className="settings-row"><div><strong>检测结构化字段</strong><span>扫描数据库、列名和解码结果</span></div><Toggle checked={value.scanStructured} onChange={(next) => update("scanStructured", next)} /></div>
          <div className="settings-row"><div><strong>检测 Base64 编码</strong><span>解码疑似 Base64 文本后匹配 Flag 检测头</span></div><Toggle checked={value.scanBase64} onChange={(next) => update("scanBase64", next)} /></div>
          <div className="settings-row"><div><strong>区分大小写</strong><span>严格匹配检测头的大小写</span></div><Toggle checked={value.caseSensitive} onChange={(next) => update("caseSensitive", next)} /></div>
          <div className="settings-row"><div><strong>命中后暂停流程</strong><span>识别到 Flag 后停止自动执行下一步</span></div><Toggle checked={value.pauseOnMatch} onChange={(next) => update("pauseOnMatch", next)} /></div>
        </section>

        <section className="settings-section" hidden={section !== "appearance"}>
          <div className="settings-section-title"><div><h2>外观</h2><p>选择适合当前环境的界面主题</p></div></div>
          <div className="theme-options" role="radiogroup" aria-label="界面主题">
            <button className={theme === "dark" ? "theme-option active" : "theme-option"} type="button" role="radio" aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")}>
              <Moon size={18} /><span><strong>暗色</strong><small>适合低光环境和长时间使用</small></span>
            </button>
            <button className={theme === "light" ? "theme-option active" : "theme-option"} type="button" role="radio" aria-checked={theme === "light"} onClick={() => onThemeChange("light")}>
              <Sun size={18} /><span><strong>亮色</strong><small>适合明亮环境和高对比阅读</small></span>
            </button>
          </div>
          <div className="settings-row"><div><strong>记住主题</strong><span>主题选择保存在本机，下次启动自动沿用</span></div><span className="settings-value">已启用</span></div>
        </section>

        {isControlled && section === "updates" && (
          <UpdateSettings
            state={props.updateState}
            onCheckUpdate={props.onCheckUpdate}
            onStartUpdate={props.onStartUpdate}
            onOpenGitHub={props.onOpenGitHub}
            onOpenReleaseNotes={props.onOpenReleaseNotes}
          />
        )}
      </div>
    </main>
  );
}
