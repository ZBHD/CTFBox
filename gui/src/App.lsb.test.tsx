import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { type AppUpdateAdapter } from "./App";
import { ToolRail } from "./components/ToolRail";
import { MiscWorkbench } from "./components/processing/MiscWorkbench";
import { DEFAULT_LSB_PARAMETERS } from "./lib/lsbEngine";
import type { LsbLocalAnalysis } from "./lib/lsbTypes";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
  invoke: vi.fn(() => Promise.reject(new Error("browser preview"))),
}));

const mounted: ReturnType<typeof create>[] = [];

beforeEach(() => {
  const values = new Map<string, string>([
    ["ctfbox.theme", "light"],
    ["ctfbox.flagPrefixes", "flag, CTF"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  });
  vi.stubGlobal("document", {
    activeElement: null,
    body: {},
    documentElement: { dataset: {} },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
  vi.unstubAllGlobals();
});

function adapter(): AppUpdateAdapter {
  return {
    checkLatest: vi.fn(async () => ({ state: { phase: "idle" as const, downloadedBytes: 0 } })),
    downloadUpdate: vi.fn(async (_update, state) => ({ state })),
    installAndRelaunch: vi.fn(async () => undefined),
    relaunch: vi.fn(async () => undefined),
    openUrl: vi.fn(async () => undefined),
  };
}

function result(): LsbLocalAnalysis {
  return {
    kind: "lsb",
    status: "completed",
    fileName: "challenge.png",
    mode: "auto",
    depth: "deep",
    parameters: DEFAULT_LSB_PARAMETERS,
    candidates: [],
  };
}

describe("App LSB task integration", () => {
  it("isolates, restores and clears structured LSB state by selection key", () => {
    const renderer = create(<App updateAdapter={adapter()} />);
    mounted.push(renderer);
    const select = (mode: string) => act(() => renderer.root.findByType(ToolRail).props.onSelect({ toolId: "misc", mode }));

    select("lsb");
    let workbench = renderer.root.findByType(MiscWorkbench);
    act(() => workbench.props.onAnalysisChange(result()));
    workbench = renderer.root.findByType(MiscWorkbench);
    expect(workbench.props.analysis).toMatchObject({ kind: "lsb", fileName: "challenge.png" });

    select("image");
    expect(renderer.root.findByType(MiscWorkbench).props.analysis).toBeUndefined();
    select("lsb");
    workbench = renderer.root.findByType(MiscWorkbench);
    expect(workbench.props.analysis).toMatchObject({ kind: "lsb", fileName: "challenge.png" });

    act(() => workbench.props.onClear());
    expect(renderer.root.findByType(MiscWorkbench).props.analysis).toBeUndefined();
  });

  it("passes global flag detection settings into the LSB workbench", () => {
    const renderer = create(<App updateAdapter={adapter()} />);
    mounted.push(renderer);
    act(() => renderer.root.findByType(ToolRail).props.onSelect({ toolId: "misc", mode: "lsb" }));
    const workbench = renderer.root.findByType(MiscWorkbench);

    expect(workbench.props.flagPrefixes).toEqual(["flag", "CTF"]);
    expect(workbench.props.flagCaseSensitive).toBe(false);
    expect(workbench.props.flagEnabled).toBe(true);
  });
});
