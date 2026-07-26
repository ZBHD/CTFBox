import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STEGO_OPTIONS } from "../../lib/stegoAnalyzer";
import type { StegoLocalAnalysis } from "../../lib/stegoTypes";
import { StegoWorkbench } from "./StegoWorkbench";
import { StegoParameterPanel } from "./stego/StegoParameterPanel";
import { StegoResultsPanel } from "./stego/StegoResultsPanel";
import { StegoSourcePanel } from "./stego/StegoSourcePanel";

const { workerAnalyze } = vi.hoisted(() => ({
  workerAnalyze: vi.fn(async () => ({
    format: "Unknown",
    findings: [],
    sections: [],
    metadata: [],
    strings: [],
    visuals: [],
    carvedFiles: [],
  })),
}));

vi.mock("../../lib/stegoWorkerClient", () => ({
  StegoWorkerClient: class {
    analyze = workerAnalyze;
    cancel = vi.fn();
    dispose = vi.fn();
  },
}));

function analysis(): StegoLocalAnalysis {
  return { kind: "stego", status: "idle", options: { ...DEFAULT_STEGO_OPTIONS }, selectedTab: "overview" };
}

describe("StegoWorkbench", () => {
  it("renders dedicated file, parameter and result surfaces", () => {
    const html = renderToStaticMarkup(<StegoWorkbench analysis={analysis()} flagPrefixes={["ctfshow"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={() => undefined} onClear={() => undefined} />);
    expect(html).toContain("输入文件与原图");
    expect(html).toContain("文件结构");
    expect(html).toContain("JPEG DCT");
    expect(html).toContain("PNG / APNG / GIF 信道");
    expect(html).toContain("图片尺寸恢复");
    expect(html).toContain("全文件递归雕刻");
    expect(html).toContain("离线 OCR");
    expect(html).toContain("总览");
    expect(html).toContain("雕刻文件");
    expect(html).toContain("multiple=\"\"");
  });

  it("updates structured options without mutating the previous state", () => {
    const onChange = vi.fn();
    const current = analysis();
    const renderer = create(<StegoParameterPanel analysis={current} disabled={false} onChange={onChange} />);
    const metadata = renderer.root.findByProps({ "aria-label": "提取元数据" });
    act(() => metadata.props.onChange({ target: { checked: false } }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ metadata: false }) }));
    expect(current.options.metadata).toBe(true);
  });

  it("rejects an oversized file before reading it into memory", () => {
    const onChange = vi.fn();
    const arrayBuffer = vi.fn();
    const renderer = create(<StegoWorkbench analysis={analysis()} flagPrefixes={["flag"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={onChange} onClear={() => undefined} />);
    const target = { files: [{ name: "huge.bin", size: 129 * 1024 * 1024, type: "application/octet-stream", arrayBuffer }], value: "C:\\fakepath\\huge.bin" };

    act(() => renderer.root.findByProps({ "aria-label": "选择隐写分析文件" }).props.onChange({
      target,
      currentTarget: target,
    }));

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("128 MiB") }));
  });

  it("toggles structure-channel analysis independently", () => {
    const onChange = vi.fn();
    const current = analysis();
    const renderer = create(<StegoParameterPanel analysis={current} disabled={false} onChange={onChange} />);
    act(() => renderer.root.findByProps({ "aria-label": "分析结构信道" }).props.onChange({ target: { checked: false } }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ channels: false }) }));
    expect(current.options.channels).toBe(true);
  });

  it("toggles OCR independently", () => {
    const onChange = vi.fn();
    const current = analysis();
    const renderer = create(<StegoParameterPanel analysis={current} disabled={false} onChange={onChange} />);
    act(() => renderer.root.findByProps({ "aria-label": "执行离线 OCR" }).props.onChange({ target: { checked: false } }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ ocr: false }) }));
    expect(current.options.ocr).toBe(true);
  });

  it("reloads candidate bytes and immediately continues the analysis pipeline", async () => {
    workerAnalyze.mockClear();
    const onChange = vi.fn();
    vi.stubGlobal("File", class {
      name: string;
      type: string;
      size: number;
      private readonly bytes: Uint8Array;

      constructor(parts: Array<ArrayBuffer>, name: string, options?: { type?: string }) {
        this.bytes = new Uint8Array(parts[0]);
        this.name = name;
        this.type = options?.type ?? "";
        this.size = this.bytes.length;
      }

      async arrayBuffer() {
        return this.bytes.slice().buffer;
      }
    });
    const current = analysis();
    current.options.ocr = false;
    const renderer = create(<StegoWorkbench analysis={current} flagPrefixes={["ctfshow"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={onChange} onClear={() => undefined} />);
    const onAnalyze = renderer.root.findByType(StegoResultsPanel).props.onAnalyze;

    await act(async () => onAnalyze(Uint8Array.of(1, 2, 3), "candidate.bin", "application/octet-stream"));

    expect(workerAnalyze).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "candidate.bin",
      mediaType: "application/octet-stream",
      bytes: Uint8Array.of(1, 2, 3),
    }), expect.anything(), expect.any(Function));
    expect(onChange.mock.calls.map(([next]) => next.status)).toEqual(expect.arrayContaining(["loading", "idle", "running", "completed"]));
    vi.unstubAllGlobals();
  });

  it("clears the native file input after reading files so the same file can be selected again", () => {
    const onFiles = vi.fn();
    const renderer = create(<StegoSourcePanel analysis={analysis()} disabled={false} onFiles={onFiles} />);
    const input = renderer.root.findByProps({ "aria-label": "选择隐写分析文件" });
    const file = { name: "repeat.png" } as File;
    const target = { files: [file], value: "C:\\fakepath\\repeat.png" };

    act(() => input.props.onChange({ target, currentTarget: target }));

    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(target.value).toBe("");
  });
});
