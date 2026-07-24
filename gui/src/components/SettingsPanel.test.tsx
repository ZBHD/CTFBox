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
    onOpenGitHub: () => void;
    onOpenReleaseNotes: () => void;
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
    onOpenGitHub: () => undefined,
    onOpenReleaseNotes: () => undefined,
    ...overrides,
  };
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child))
    .join("");
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType("button").find((button) => textContent(button).includes(label));
}

describe("SettingsPanel", () => {
  it("keeps the desktop shell fixed while the settings area owns minimum-window scrolling", () => {
    expect(stylesheet).toMatch(/html, body, #root\s*\{[^}]*min-width:\s*900px;[^}]*min-height:\s*600px;/s);
    expect(stylesheet).toMatch(/body\s*\{[^}]*overflow:\s*hidden;/s);
    expect(stylesheet).toMatch(/\.settings-layout\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/s);
    expect(stylesheet).not.toMatch(/\.settings-updates\s*\{[^}]*overflow:\s*hidden;/s);
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

    expect(content).toContain("当前版本");
    expect(content).toContain("v0.1.0");
    expect(content).toContain("最新版本");
    expect(content).toContain("v0.2.0");
    expect(content).toContain("2026-07-24");
    expect(content).toContain("新增应用内更新。");

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
    ["checking", "正在检查更新"],
    ["latest", "当前已是最新版本"],
    ["ready", "更新已准备好"],
  ] as const)("renders the %s update state", (phase, expected) => {
    const html = renderToStaticMarkup(
      <SettingsPanel {...controlledProps({ phase, currentVersion: "0.1.0", downloadedBytes: 0 })} />,
    );

    expect(html).toContain(expected);
  });

  it("formats an update error and retries the check", () => {
    const onCheckUpdate = vi.fn();
    const panel = create(
      <SettingsPanel
        {...controlledProps({
          phase: "error",
          currentVersion: "0.1.0",
          downloadedBytes: 0,
          error: "  无法连接更新服务  ",
        }, { onCheckUpdate })}
      />,
    );

    expect(textContent(panel.root)).toContain("无法连接更新服务");
    act(() => findButton(panel.root, "重试")?.props.onClick());
    expect(onCheckUpdate).toHaveBeenCalledTimes(1);
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
