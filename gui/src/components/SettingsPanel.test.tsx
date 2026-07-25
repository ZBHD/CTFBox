// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { readFileSync } from "node:fs";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UpdateState } from "../lib/updateManager";
import {
  SettingsPanel,
  type FlagSettings,
  type SettingsSection,
} from "./SettingsPanel";

const settings: FlagSettings = {
  enabled: true,
  prefixes: "flag, CTF",
  scanOutput: true,
  scanStructured: true,
  scanBase64: true,
  caseSensitive: false,
  pauseOnMatch: false,
};

const idleState: UpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};

const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function controlledProps(
  updateState: UpdateState = idleState,
  overrides: Partial<{
    section: SettingsSection;
    onSectionChange: (section: SettingsSection) => void;
    onCheckUpdate: () => void;
    onStartUpdate: () => void;
    onRestartUpdate: () => void;
    onOpenGitHub: () => void;
    onOpenReleaseNotes: () => void;
    restartBusy: boolean;
    restartError: string | undefined;
    restartActionLabel: string;
    linkError: string | undefined;
  }> = {},
) {
  return {
    value: settings,
    theme: "dark" as const,
    onChange: () => undefined,
    onThemeChange: () => undefined,
    section: "updates" as SettingsSection,
    onSectionChange: () => undefined,
    updateState,
    onCheckUpdate: () => undefined,
    onStartUpdate: () => undefined,
    onRestartUpdate: () => undefined,
    onOpenGitHub: () => undefined,
    onOpenReleaseNotes: () => undefined,
    restartBusy: false,
    restartError: undefined,
    restartActionLabel: "立即重启",
    linkError: undefined,
    ...overrides,
  };
}

function assertControlledRestartContract() {
  // @ts-expect-error Controlled update settings require restart and link status props.
  return <SettingsPanel
    value={settings}
    theme="dark"
    onChange={() => undefined}
    onThemeChange={() => undefined}
    section="updates"
    onSectionChange={() => undefined}
    updateState={idleState}
    onCheckUpdate={() => undefined}
    onStartUpdate={() => undefined}
    onOpenGitHub={() => undefined}
    onOpenReleaseNotes={() => undefined}
  />;
}

function assertLegacyHasNoRestartAction() {
  // @ts-expect-error Legacy settings must not expose a disconnected restart action.
  return <SettingsPanel
    value={settings}
    theme="dark"
    onChange={() => undefined}
    onThemeChange={() => undefined}
    onRestartUpdate={() => undefined}
  />;
}

void assertControlledRestartContract;
void assertLegacyHasNoRestartAction;

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child))
    .join("");
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType("button").find((button) => textContent(button).includes(label));
}

function cssRuleColor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));
  const color = rule?.[1].match(/(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i)?.[1];
  if (!color) throw new Error(`CSS rule has no hex color: ${selector}`);
  return color;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("SettingsPanel", () => {
  it("keeps the desktop shell fixed while the settings area owns minimum-window scrolling", () => {
    expect(stylesheet).toMatch(/html, body, #root\s*\{[^}]*min-width:\s*900px;[^}]*min-height:\s*600px;/s);
    expect(stylesheet).toMatch(/body\s*\{[^}]*overflow:\s*hidden;/s);
    expect(stylesheet).toMatch(/\.settings-layout\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/s);
    expect(stylesheet).not.toMatch(/\.settings-updates\s*\{[^}]*overflow:\s*hidden;/s);
  });

  it("keeps update metadata and progress text above WCAG AA contrast", () => {
    const colors = [
      [cssRuleColor(".update-version-item span"), "#0c1217"],
      [cssRuleColor(':root[data-theme="light"] .update-version-item span'), "#f6f9fa"],
      [cssRuleColor(".update-progress-heading span, .update-progress-bytes"), "#10171d"],
      [cssRuleColor(':root[data-theme="light"] .update-progress-heading span, :root[data-theme="light"] .update-progress-bytes'), "#ffffff"],
      [cssRuleColor(".update-inline-error"), "#24171b"],
      [cssRuleColor(':root[data-theme="light"] .update-inline-error'), "#fff3f4"],
      [cssRuleColor(".update-ready-error"), "#24171b"],
      [cssRuleColor(':root[data-theme="light"] .update-ready-error'), "#fff3f4"],
    ];

    for (const [foreground, background] of colors) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(stylesheet).toMatch(/\.update-inline-error\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(stylesheet).toMatch(/\.update-ready-error\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  });

  it("exposes an appearance section for the persisted theme", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel value={settings} theme="dark" onChange={() => undefined} onThemeChange={() => undefined} />,
    );

    expect(html).toContain("外观");
    expect(html).toContain("亮色");
  });

  it("selects the controlled version update section and delegates navigation", () => {
    const onSectionChange = vi.fn();
    const panel = create(<SettingsPanel {...controlledProps(idleState, { onSectionChange })} />);
    const updateNav = findButton(panel.root, "版本更新");
    const updateSection = panel.root.findAllByType("section").find((section) => (
      section.props["aria-labelledby"] === "settings-updates-title"
    ));

    expect(updateNav?.props.className).toContain("active");
    expect(updateNav?.props["aria-current"]).toBe("page");
    expect(updateSection?.props.hidden).toBe(false);
    expect(updateSection && textContent(updateSection)).toContain("CTFBox");

    act(() => findButton(panel.root, "外观")?.props.onClick());
    expect(onSectionChange).toHaveBeenCalledWith("appearance");
  });

  it("shows an available release and starts the requested update", () => {
    const onStartUpdate = vi.fn();
    const panel = create(
      <SettingsPanel
        {...controlledProps({
          phase: "available",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
          date: "2026-07-24",
          notes: "新增应用内更新。",
          downloadedBytes: 0,
        }, { onStartUpdate })}
      />,
    );
    const content = textContent(panel.root);
    const announcement = panel.root.findByProps({ role: "status" });

    expect(content).toContain("当前版本");
    expect(content).toContain("v0.1.0");
    expect(content).toContain("最新版本");
    expect(content).toContain("v0.2.0");
    expect(content).toContain("2026-07-24");
    expect(content).toContain("新增应用内更新。");
    expect(textContent(announcement)).toContain("发现新版本");
    expect(textContent(announcement)).not.toContain("更新到");

    act(() => findButton(panel.root, "更新到 v0.2.0")?.props.onClick());
    expect(onStartUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports determinate download progress with bytes and percentage", () => {
    const panel = create(
      <SettingsPanel
        {...controlledProps({
          phase: "downloading",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
          downloadedBytes: 262_144,
          totalBytes: 1_048_576,
        })}
      />,
    );
    const progress = panel.root.findByProps({ role: "progressbar" });
    const content = textContent(panel.root);

    expect(progress.props["aria-valuenow"]).toBe(25);
    expect(progress.props["aria-valuemin"]).toBe(0);
    expect(progress.props["aria-valuemax"]).toBe(100);
    expect(content).toContain("25%");
    expect(content).toContain("256 KB / 1 MB");
  });

  it.each([
    [0, 100, 0, "0%"],
    [125, 100, 100, "100%"],
  ] as const)("clamps download progress %s/%s to %s%%", (downloadedBytes, totalBytes, expected, label) => {
    const panel = create(
      <SettingsPanel {...controlledProps({ phase: "downloading", downloadedBytes, totalBytes })} />,
    );
    const progress = panel.root.findByProps({ role: "progressbar" });

    expect(progress.props["aria-valuenow"]).toBe(expected);
    expect(textContent(panel.root)).toContain(label);
  });

  it("keeps unknown download totals indeterminate", () => {
    const panel = create(
      <SettingsPanel {...controlledProps({ phase: "downloading", downloadedBytes: 512 })} />,
    );
    const progress = panel.root.findByProps({ role: "progressbar" });

    expect(progress.props["aria-valuenow"]).toBeUndefined();
    expect(progress.props["aria-valuetext"]).toBe("512 B 已下载");
    expect(textContent(panel.root)).toContain("计算进度中");
  });

  it("disables repeated checks while checking", () => {
    const panel = create(
      <SettingsPanel {...controlledProps({ phase: "checking", downloadedBytes: 0 })} />,
    );

    expect(findButton(panel.root, "正在检查")?.props.disabled).toBe(true);
  });

  it.each([
    ["checking", "正在检查更新"],
    ["latest", "当前已是最新版本"],
    ["ready", "更新已准备好"],
  ] as const)("renders the %s update state", (phase, expected) => {
    const html = renderToStaticMarkup(
      <SettingsPanel {...controlledProps({ phase, currentVersion: "0.1.0", downloadedBytes: 0 })} />,
    );

    expect(html).toContain(expected);
  });

  it("keeps a restart action in the ready settings state and disables it while busy", () => {
    const onRestartUpdate = vi.fn();
    const readyState: UpdateState = {
      phase: "ready",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      downloadedBytes: 128,
      totalBytes: 128,
    };
    const panel = create(
      <SettingsPanel
        {...controlledProps(readyState, {
          onRestartUpdate,
          restartBusy: true,
          restartActionLabel: "重试安装",
        })}
      />,
    );
    const restart = findButton(panel.root, "重试安装");

    expect(restart?.props.disabled).toBe(true);
    act(() => panel.update(
      <SettingsPanel
        {...controlledProps(readyState, {
          onRestartUpdate,
          restartBusy: false,
          restartActionLabel: "重试安装",
        })}
      />,
    ));
    const enabledRestart = findButton(panel.root, "重试安装");
    expect(enabledRestart?.props.disabled).toBe(false);
    act(() => enabledRestart?.props.onClick());
    expect(onRestartUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows restart and link failures in independent alert regions", () => {
    const panel = create(
      <SettingsPanel
        {...controlledProps({
          phase: "ready",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
          downloadedBytes: 128,
        }, {
          restartError: "安装更新失败：installer failed",
          restartActionLabel: "重试安装",
          linkError: "打开链接失败：offline",
        })}
      />,
    );
    const alerts = panel.root.findAllByProps({ role: "alert" }).map(textContent);

    expect(alerts).toContain("安装更新失败：installer failed");
    expect(alerts).toContain("打开链接失败：offline");
    expect(textContent(panel.root)).toContain("重试安装");
  });

  it("does not expose update actions in the legacy settings panel", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel value={settings} theme="dark" onChange={() => undefined} onThemeChange={() => undefined} />,
    );

    expect(html).not.toContain("立即重启");
    expect(html).not.toContain("重试安装");
    expect(html).not.toContain("再次重启");
  });

  it("formats a check error and checks again", () => {
    const onCheckUpdate = vi.fn();
    const onStartUpdate = vi.fn();
    const panel = create(
      <SettingsPanel
        {...controlledProps({
          phase: "error",
          currentVersion: "0.1.0",
          downloadedBytes: 0,
          error: "  无法连接更新服务  ",
        }, { onCheckUpdate, onStartUpdate })}
      />,
    );

    expect(textContent(panel.root)).toContain("检查更新失败");
    expect(textContent(panel.root)).toContain("无法连接更新服务");
    act(() => findButton(panel.root, "重新检查")?.props.onClick());
    expect(onCheckUpdate).toHaveBeenCalledTimes(1);
    expect(onStartUpdate).not.toHaveBeenCalled();
  });

  it("formats a download error and downloads again", () => {
    const onCheckUpdate = vi.fn();
    const onStartUpdate = vi.fn();
    const panel = create(
      <SettingsPanel
        {...controlledProps({
          phase: "error",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
          downloadedBytes: 0,
          error: "  签名校验失败  ",
        }, { onCheckUpdate, onStartUpdate })}
      />,
    );

    expect(textContent(panel.root)).toContain("下载更新失败");
    expect(textContent(panel.root)).toContain("签名校验失败");
    act(() => findButton(panel.root, "重新下载")?.props.onClick());
    expect(onStartUpdate).toHaveBeenCalledTimes(1);
    expect(onCheckUpdate).not.toHaveBeenCalled();
  });

  it("delegates update links and manual checks without an official website link", () => {
    const onCheckUpdate = vi.fn();
    const onOpenGitHub = vi.fn();
    const onOpenReleaseNotes = vi.fn();
    const panel = create(
      <SettingsPanel
        {...controlledProps(idleState, {
          onCheckUpdate,
          onOpenGitHub,
          onOpenReleaseNotes,
        })}
      />,
    );

    act(() => findButton(panel.root, "GitHub")?.props.onClick());
    act(() => findButton(panel.root, "更新日志")?.props.onClick());
    act(() => findButton(panel.root, "手动检查")?.props.onClick());

    expect(onOpenGitHub).toHaveBeenCalledTimes(1);
    expect(onOpenReleaseNotes).toHaveBeenCalledTimes(1);
    expect(onCheckUpdate).toHaveBeenCalledTimes(1);
    expect(textContent(panel.root)).not.toContain("官方网站");
  });
});
