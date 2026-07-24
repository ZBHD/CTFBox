import { Flag, Moon, Settings2, Sun, SunMoon } from "lucide-react";
import { useState } from "react";
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

interface SettingsPanelProps {
  value: FlagSettings;
  theme: Theme;
  onChange: (value: FlagSettings) => void;
  onThemeChange: (theme: Theme) => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <button className={`toggle ${checked ? "toggle-on" : ""}`} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>;
}

export function SettingsPanel({ value, theme, onChange, onThemeChange }: SettingsPanelProps) {
  const [section, setSection] = useState<"flags" | "appearance">("flags");
  const update = <K extends keyof FlagSettings>(key: K, next: FlagSettings[K]) => onChange({ ...value, [key]: next });
  return (
    <main className="settings-page">
      <header className="settings-header">
        <div><span className="workspace-kicker">应用设置</span><h1>设置</h1><p>配置识别、外观和运行行为</p></div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          <button className={section === "flags" ? "active" : ""} type="button" onClick={() => setSection("flags")}><Flag size={15} />Flag 识别</button>
          <button className={section === "appearance" ? "active" : ""} type="button" onClick={() => setSection("appearance")}><SunMoon size={15} />外观</button>
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
      </div>
    </main>
  );
}
