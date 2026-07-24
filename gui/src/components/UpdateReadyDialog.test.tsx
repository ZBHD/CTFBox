// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { readFileSync } from "node:fs";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { UpdateReadyDialog } from "./UpdateReadyDialog";

const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child))
    .join("");
}

function findButton(root: ReactTestInstance, label: string) {
  const button = root.findAllByType("button").find((candidate) => textContent(candidate) === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function renderDialog(onPostpone = vi.fn(), onRestart = vi.fn()) {
  return {
    dialog: create(
      <UpdateReadyDialog version="0.2.0" onPostpone={onPostpone} onRestart={onRestart} />,
    ),
    onPostpone,
    onRestart,
  };
}

describe("UpdateReadyDialog", () => {
  it("presents the verified target version as an accessible modal", () => {
    const { dialog } = renderDialog();
    const modal = dialog.root.findByProps({ role: "dialog" });
    const heading = dialog.root.findByProps({ id: "update-ready-title" });
    const content = textContent(dialog.root);

    expect(modal.props["aria-modal"]).toBe(true);
    expect(modal.props["aria-labelledby"]).toBe("update-ready-title");
    expect(heading.type).toBe("h2");
    expect(content).toContain("更新已准备好");
    expect(content).toContain("v0.2.0");
    expect(content).toContain("更新已经过验证，将在重启时完成安装");
    expect(content).toContain("稍后重启");
    expect(content).toContain("立即重启");
  });

  it("delegates postpone without starting a restart", () => {
    const { dialog, onPostpone, onRestart } = renderDialog();

    act(() => findButton(dialog.root, "稍后重启").props.onClick());

    expect(onPostpone).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("delegates restart without postponing", () => {
    const { dialog, onPostpone, onRestart } = renderDialog();

    act(() => findButton(dialog.root, "立即重启").props.onClick());

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onPostpone).not.toHaveBeenCalled();
  });

  it("maps Escape to postpone and ignores other keys", () => {
    const { dialog, onPostpone, onRestart } = renderDialog();
    const modal = dialog.root.findByProps({ role: "dialog" });
    const escapeEvent = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => modal.props.onKeyDown({ key: "Enter" }));
    expect(onPostpone).not.toHaveBeenCalled();

    act(() => modal.props.onKeyDown(escapeEvent));
    expect(onPostpone).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(escapeEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("gives the immediate restart action initial focus", () => {
    const { dialog } = renderDialog();

    expect(findButton(dialog.root, "立即重启").props.autoFocus).toBe(true);
    expect(findButton(dialog.root, "稍后重启").props.autoFocus).not.toBe(true);
  });

  it("restores the previously focused control when dismissed", async () => {
    const focus = vi.fn();
    vi.stubGlobal("document", { activeElement: { focus } });
    let dialog: ReactTestRenderer;

    try {
      act(() => {
        dialog = create(
          <UpdateReadyDialog version="0.2.0" onPostpone={() => undefined} onRestart={() => undefined} />,
        );
      });
      expect(focus).not.toHaveBeenCalled();

      await act(async () => {
        dialog.unmount();
        await Promise.resolve();
      });
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defines bounded, theme-aware modal styles without decorative motion", () => {
    expect(stylesheet).toMatch(/\.update-ready-backdrop\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*\d+;[^}]*background:\s*rgba\([^)]*,\s*\.5\);/s);
    expect(stylesheet).toMatch(/\.update-ready-dialog\s*\{[^}]*width:\s*min\([^;]+\);[^}]*max-height:\s*calc\(100vh\s*-\s*\d+px\);[^}]*overflow:\s*auto;[^}]*border-radius:\s*[0-8]px;/s);
    expect(stylesheet).toMatch(/\.update-ready-version\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(stylesheet).toMatch(/\.update-ready-primary:focus-visible[^}]*\{[^}]*outline:/s);
    expect(stylesheet).toMatch(/\.update-ready-actions button:disabled\s*\{[^}]*cursor:\s*not-allowed;/s);
    expect(stylesheet).toMatch(/:root\[data-theme="light"\] \.update-ready-dialog\s*\{/s);
    expect(stylesheet).not.toMatch(/\.update-ready-[^{]*\{[^}]*(?:gradient|animation):/s);
  });
});
