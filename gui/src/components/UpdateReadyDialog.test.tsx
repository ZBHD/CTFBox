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
  let dialog: ReactTestRenderer;
  act(() => {
    dialog = create(
      <UpdateReadyDialog version="0.2.0" onPostpone={onPostpone} onRestart={onRestart} />,
    );
  });
  return {
    dialog: dialog!,
    onPostpone,
    onRestart,
  };
}

interface FocusNodeMock {
  focus: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  contains?: (target: unknown) => boolean;
}

type Listener = (event: Record<string, unknown>) => void;

function createDomHarness() {
  const listeners = new Map<string, Set<Listener>>();
  const documentMock = {
    activeElement: null as FocusNodeMock | null,
    body: null as unknown as FocusNodeMock,
    addEventListener: vi.fn((type: string, listener: Listener) => {
      const entries = listeners.get(type) ?? new Set<Listener>();
      entries.add(listener);
      listeners.set(type, entries);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  const emit = (type: string, event: Record<string, unknown>) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const focusNode = (): FocusNodeMock => {
    const node: FocusNodeMock = {
      focus: vi.fn(() => {
        documentMock.activeElement = node;
        emit("focusin", { target: node });
      }),
      isConnected: true,
    };
    return node;
  };
  const previous = focusNode();
  const body = focusNode();
  const postpone = focusNode();
  const restart = focusNode();
  const outside = focusNode();
  const dialog = focusNode();
  dialog.contains = (target) => target === dialog || target === postpone || target === restart;
  documentMock.activeElement = previous;
  documentMock.body = body;

  return {
    body,
    dialog,
    documentMock,
    outside,
    postpone,
    previous,
    restart,
    emit,
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    createNodeMock(element: { props: { className?: string } }) {
      if (element.props.className === "update-ready-dialog") return dialog;
      if (element.props.className === "update-ready-secondary") return postpone;
      if (element.props.className === "update-ready-primary") return restart;
      return {};
    },
  };
}

function keyEvent(key: string, options: { shiftKey?: boolean; repeat?: boolean } = {}) {
  return {
    key,
    shiftKey: options.shiftKey ?? false,
    repeat: options.repeat ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function renderDialogWithDom(
  harness: ReturnType<typeof createDomHarness>,
  props: Partial<{
    busy: boolean;
    onPostpone: () => void;
    onRestart: () => void;
  }> = {},
) {
  const onPostpone = props.onPostpone ?? vi.fn();
  const onRestart = props.onRestart ?? vi.fn();
  vi.stubGlobal("document", harness.documentMock);
  let dialog: ReactTestRenderer;
  act(() => {
    dialog = create(
      <UpdateReadyDialog
        version="0.2.0"
        busy={props.busy}
        onPostpone={onPostpone}
        onRestart={onRestart}
      />,
      { createNodeMock: harness.createNodeMock },
    );
  });
  return { dialog: dialog!, onPostpone, onRestart };
}

const unmountedDialogs = new WeakSet<ReactTestRenderer>();

async function unmountDialog(dialog: ReactTestRenderer) {
  if (unmountedDialogs.has(dialog)) return;
  unmountedDialogs.add(dialog);
  await act(async () => {
    dialog.unmount();
    await Promise.resolve();
  });
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

  it("handles Escape globally once and ignores repeat or unrelated keys", async () => {
    const harness = createDomHarness();
    const { dialog, onPostpone, onRestart } = renderDialogWithDom(harness);
    const enter = keyEvent("Enter");
    const escape = keyEvent("Escape");
    const repeatedEscape = keyEvent("Escape", { repeat: true });

    try {
      act(() => harness.emit("keydown", enter));
      act(() => harness.emit("keydown", escape));
      act(() => harness.emit("keydown", repeatedEscape));
      act(() => harness.emit("keydown", keyEvent("Escape")));

      expect(onPostpone).toHaveBeenCalledTimes(1);
      expect(onRestart).not.toHaveBeenCalled();
      expect(enter.preventDefault).not.toHaveBeenCalled();
      expect(escape.preventDefault).toHaveBeenCalledTimes(1);
      expect(escape.stopPropagation).toHaveBeenCalledTimes(1);
      expect(repeatedEscape.preventDefault).toHaveBeenCalledTimes(1);
    } finally {
      await unmountDialog(dialog);
      vi.unstubAllGlobals();
    }
  });

  it("gives the immediate restart action initial focus", () => {
    const { dialog } = renderDialog();

    expect(findButton(dialog.root, "立即重启").props.autoFocus).toBe(true);
    expect(findButton(dialog.root, "稍后重启").props.autoFocus).not.toBe(true);
  });

  it("cycles Tab and Shift+Tab between the two actions", async () => {
    const harness = createDomHarness();
    const { dialog } = renderDialogWithDom(harness);
    try {
      harness.documentMock.activeElement = harness.restart;
      const tab = keyEvent("Tab");
      act(() => harness.emit("keydown", tab));
      expect(tab.preventDefault).toHaveBeenCalledTimes(1);
      expect(harness.postpone.focus).toHaveBeenCalledTimes(1);

      harness.documentMock.activeElement = harness.postpone;
      const reverseTab = keyEvent("Tab", { shiftKey: true });
      act(() => harness.emit("keydown", reverseTab));
      expect(reverseTab.preventDefault).toHaveBeenCalledTimes(1);
      expect(harness.restart.focus).toHaveBeenCalledTimes(1);
    } finally {
      await unmountDialog(dialog);
      vi.unstubAllGlobals();
    }
  });

  it("redirects escaped focus to restart and cleans up document listeners", async () => {
    const harness = createDomHarness();
    const { dialog } = renderDialogWithDom(harness);
    try {
      expect(harness.listenerCount("keydown")).toBe(1);
      expect(harness.listenerCount("focusin")).toBe(1);

      act(() => harness.outside.focus());
      expect(harness.restart.focus).toHaveBeenCalledTimes(1);
      expect(harness.documentMock.activeElement).toBe(harness.restart);

      await unmountDialog(dialog);
      expect(harness.listenerCount("keydown")).toBe(0);
      expect(harness.listenerCount("focusin")).toBe(0);
      act(() => harness.emit("focusin", { target: harness.outside }));
      expect(harness.restart.focus).toHaveBeenCalledTimes(1);
    } finally {
      await unmountDialog(dialog);
      vi.unstubAllGlobals();
    }
  });

  it("locks rapid restart clicks before the parent rerenders", () => {
    const { dialog, onPostpone, onRestart } = renderDialog();
    const restart = findButton(dialog.root, "立即重启");

    act(() => {
      restart.props.onClick();
      restart.props.onClick();
    });

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onPostpone).not.toHaveBeenCalled();
  });

  it("disables both actions and suppresses Escape while busy", async () => {
    const harness = createDomHarness();
    const { dialog, onPostpone, onRestart } = renderDialogWithDom(harness, { busy: true });
    try {
      const postpone = findButton(dialog.root, "稍后重启");
      const restart = findButton(dialog.root, "立即重启");
      expect(postpone.props.disabled).toBe(true);
      expect(restart.props.disabled).toBe(true);
      expect(harness.dialog.focus).toHaveBeenCalledTimes(1);
      expect(harness.documentMock.activeElement).toBe(harness.dialog);

      act(() => {
        postpone.props.onClick();
        restart.props.onClick();
        harness.emit("keydown", keyEvent("Escape"));
      });
      expect(onPostpone).not.toHaveBeenCalled();
      expect(onRestart).not.toHaveBeenCalled();
    } finally {
      await unmountDialog(dialog);
      vi.unstubAllGlobals();
    }
  });

  it("unlocks the action when a callback throws synchronously", () => {
    const error = new Error("restart failed");
    const onRestart = vi.fn(() => { throw error; });
    const { dialog } = renderDialog(vi.fn(), onRestart);
    const restart = findButton(dialog.root, "立即重启");

    expect(() => restart.props.onClick()).toThrow(error);
    expect(() => restart.props.onClick()).toThrow(error);
    expect(onRestart).toHaveBeenCalledTimes(2);
  });

  it("unlocks restart after a controlled busy cycle", () => {
    const onPostpone = vi.fn();
    const onRestart = vi.fn();
    const view = (busy: boolean) => (
      <UpdateReadyDialog
        version="0.2.0"
        busy={busy}
        onPostpone={onPostpone}
        onRestart={onRestart}
      />
    );
    let dialog: ReactTestRenderer;
    act(() => { dialog = create(view(false)); });

    act(() => findButton(dialog!.root, "立即重启").props.onClick());
    expect(onRestart).toHaveBeenCalledTimes(1);

    act(() => dialog!.update(view(true)));
    expect(findButton(dialog!.root, "立即重启").props.disabled).toBe(true);
    act(() => dialog!.update(view(false)));
    act(() => findButton(dialog!.root, "立即重启").props.onClick());

    expect(onRestart).toHaveBeenCalledTimes(2);
    expect(onPostpone).not.toHaveBeenCalled();
  });

  it.each(["empty", "body", "detached"] as const)(
    "restores previous focus when current focus is %s",
    async (state) => {
      const harness = createDomHarness();
      const { dialog } = renderDialogWithDom(harness);
      try {
        harness.documentMock.activeElement = state === "empty"
          ? null
          : state === "body"
            ? harness.body
            : { focus: vi.fn(), isConnected: false };

        await unmountDialog(dialog);
        expect(harness.previous.focus).toHaveBeenCalledTimes(1);
      } finally {
        await unmountDialog(dialog);
        vi.unstubAllGlobals();
      }
    },
  );

  it("does not overwrite focus chosen by a successor UI", async () => {
    const harness = createDomHarness();
    const { dialog } = renderDialogWithDom(harness);
    try {
      harness.documentMock.activeElement = harness.outside;

      await unmountDialog(dialog);
      expect(harness.previous.focus).not.toHaveBeenCalled();
    } finally {
      await unmountDialog(dialog);
      vi.unstubAllGlobals();
    }
  });

  it("defines bounded, theme-aware modal styles without decorative motion", () => {
    expect(stylesheet).toMatch(/\.update-ready-backdrop\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*\d+;[^}]*background:\s*rgba\([^)]*,\s*\.5\);/s);
    expect(stylesheet).toMatch(/\.update-ready-dialog\s*\{[^}]*width:\s*min\([^;]+\);[^}]*max-height:\s*calc\(100vh\s*-\s*\d+px\);[^}]*overflow:\s*auto;[^}]*border-radius:\s*[0-8]px;/s);
    expect(stylesheet).toMatch(/\.update-ready-version\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(stylesheet).toMatch(/\.update-ready-primary:focus-visible[^}]*\{[^}]*outline:/s);
    expect(stylesheet).toMatch(/:root\[data-theme="light"\] \.update-ready-primary:focus-visible[^}]*\{[^}]*outline-color:\s*#237f99;/s);
    expect(stylesheet).toMatch(/\.update-ready-actions button:disabled\s*\{[^}]*cursor:\s*not-allowed;/s);
    expect(stylesheet).toMatch(/:root\[data-theme="light"\] \.update-ready-dialog\s*\{/s);
    expect(stylesheet).not.toMatch(/\.update-ready-[^{]*\{[^}]*(?:gradient|animation):/s);
  });
});
