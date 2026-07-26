import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STEGO_OPTIONS } from "../../../lib/stegoAnalyzer";
import type { StegoLocalAnalysis } from "../../../lib/stegoTypes";
import { StegoResultsPanel } from "./StegoResultsPanel";

function analysis(): StegoLocalAnalysis {
  return {
    kind: "stego",
    status: "completed",
    fileName: "sample.png",
    options: { ...DEFAULT_STEGO_OPTIONS },
    selectedTab: "overview",
    report: {
      format: "PNG",
      logicalEnd: 100,
      findings: [{ id: "flag", severity: "high", source: "ASCII", title: "发现 Flag", detail: "ctfshow{result}", offset: 42 }],
      metadata: [{ group: "PNG 文本", key: "Comment", value: "hello", offset: 12 }],
      sections: [{ type: "png-chunk", name: "tEXt", offset: 8, length: 20, status: "ok" }],
      strings: [{ encoding: "ASCII", offset: 42, text: "ctfshow{result}", flags: ["ctfshow{result}"] }],
      visuals: [{ id: "fft", label: "FFT 128 x 128", width: 1, height: 1, pixels: Uint8ClampedArray.of(255, 255, 255, 255) }],
      dct: { supported: true, width: 8, height: 8, components: 1, blocks: 1, zeroAcRatio: 1, oddRatios: Array(64).fill(0), coefficientCounts: Array(64).fill(1), warnings: [] },
      carvedFiles: [
        { name: "payload.zip", mediaType: "application/zip", offset: 100, bytes: Uint8Array.of(1, 2, 3) },
        { name: "hidden.png", mediaType: "image/png", offset: 200, bytes: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10) },
      ],
      channels: [{ id: "channel-1", source: "PNG IDAT 长度", label: "ASCII", value: "ctfshow{channel}", confidence: "high", detail: "8 位", flags: ["ctfshow{channel}"] }],
      repairs: [{ id: "repair-1", format: "PNG", label: "IHDR CRC 精确反推 37 x 23", width: 37, height: 23, confidence: "exact", detail: "CRC 匹配", bytes: Uint8Array.of(7, 8, 9) }],
      ocr: [{ sourceId: "visual:apng-frame-004", sourceLabel: "APNG 异常帧 4", text: "ctfshow{ocr_result}", confidence: 93, flags: ["ctfshow{ocr_result}"] }],
    },
  };
}

describe("StegoResultsPanel", () => {
  it("renders all result tabs and high-confidence evidence", () => {
    const html = renderToStaticMarkup(<StegoResultsPanel analysis={analysis()} onTab={() => undefined} onExport={() => undefined} onAnalyze={() => undefined} />);
    for (const label of ["总览", "信道候选", "修复候选", "元数据", "结构", "字符串", "可视化", "OCR", "DCT", "雕刻文件"]) expect(html).toContain(label);
    expect(html).toContain("ctfshow{result}");
    expect(html).toContain("0x2a");
  });

  it("switches tabs and exports carved files", () => {
    const onTab = vi.fn();
    const onExport = vi.fn();
    const current = analysis();
    current.selectedTab = "files";
    const renderer = create(<StegoResultsPanel analysis={current} onTab={onTab} onExport={onExport} onAnalyze={() => undefined} />);
    act(() => renderer.root.findByProps({ "aria-label": "查看元数据" }).props.onClick());
    expect(onTab).toHaveBeenCalledWith("metadata");
    act(() => renderer.root.findByProps({ "aria-label": "导出 payload.zip" }).props.onClick());
    expect(onExport).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3), "payload.zip", "application/zip");
  });

  it("renders and copies decoded structure-channel candidates", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const current = analysis();
    current.selectedTab = "channels";
    const renderer = create(<StegoResultsPanel analysis={current} onTab={() => undefined} onExport={() => undefined} onAnalyze={() => undefined} />);
    await act(async () => renderer.root.findByProps({ "aria-label": "复制信道候选" }).props.onClick());
    expect(writeText).toHaveBeenCalledWith("ctfshow{channel}");
    vi.unstubAllGlobals();
  });

  it("exports a dimension-repaired copy without mutating the source", () => {
    const onExport = vi.fn();
    const current = analysis();
    current.selectedTab = "repairs";
    const renderer = create(<StegoResultsPanel analysis={current} onTab={() => undefined} onExport={onExport} onAnalyze={() => undefined} />);
    act(() => renderer.root.findByProps({ "aria-label": "导出尺寸修复 37 x 23" }).props.onClick());
    expect(onExport).toHaveBeenCalledWith(Uint8Array.of(7, 8, 9), "repaired-37x23.png", "image/png");
  });

  it("copies a suspected flag directly from its finding card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const current = analysis();
    current.report!.findings[0] = {
      ...current.report!.findings[0],
      severity: "suspicious",
      title: "疑似 Flag",
      detail: "ctfshow{32}",
    };
    const renderer = create(<StegoResultsPanel analysis={current} onTab={() => undefined} onExport={() => undefined} onAnalyze={() => undefined} />);

    await act(async () => renderer.root.findByProps({ "aria-label": "复制疑似 Flag" }).props.onClick());

    expect(writeText).toHaveBeenCalledWith("ctfshow{32}");
    vi.unstubAllGlobals();
  });

  it("renders OCR evidence and copies an OCR Flag", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const current = analysis();
    current.selectedTab = "ocr";
    const renderer = create(<StegoResultsPanel analysis={current} onTab={() => undefined} onExport={() => undefined} onAnalyze={() => undefined} />);

    await act(async () => renderer.root.findByProps({ "aria-label": "复制 OCR Flag ctfshow{ocr_result}" }).props.onClick());

    expect(writeText).toHaveBeenCalledWith("ctfshow{ocr_result}");
    vi.unstubAllGlobals();
  });

  it("previews and continues analysis from repaired image bytes", async () => {
    const onAnalyze = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:repair"), revokeObjectURL: vi.fn() });
    const current = analysis();
    current.selectedTab = "repairs";
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<StegoResultsPanel analysis={current} onTab={() => undefined} onExport={() => undefined} onAnalyze={onAnalyze} />);
    });

    expect(renderer!.root.findByProps({ "aria-label": "预览 repaired-37x23.png" }).props.src).toBe("blob:repair");
    act(() => renderer!.root.findByProps({ "aria-label": "继续分析尺寸修复 37 x 23" }).props.onClick());
    expect(onAnalyze).toHaveBeenCalledWith(Uint8Array.of(7, 8, 9), "repaired-37x23.png", "image/png");
    renderer!.unmount();
    vi.unstubAllGlobals();
  });

  it("previews and continues analysis from carved image bytes", async () => {
    const onAnalyze = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:carved"), revokeObjectURL: vi.fn() });
    const current = analysis();
    current.selectedTab = "files";
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<StegoResultsPanel analysis={current} onTab={() => undefined} onExport={() => undefined} onAnalyze={onAnalyze} />);
    });

    expect(renderer!.root.findByProps({ "aria-label": "预览 hidden.png" }).props.src).toBe("blob:carved");
    act(() => renderer!.root.findByProps({ "aria-label": "继续分析 hidden.png" }).props.onClick());
    expect(onAnalyze).toHaveBeenCalledWith(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), "hidden.png", "image/png");
    renderer!.unmount();
    vi.unstubAllGlobals();
  });
});
