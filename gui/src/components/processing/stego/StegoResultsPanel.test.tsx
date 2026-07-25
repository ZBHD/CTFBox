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
      carvedFiles: [{ name: "payload.zip", mediaType: "application/zip", offset: 100, bytes: Uint8Array.of(1, 2, 3) }],
    },
  };
}

describe("StegoResultsPanel", () => {
  it("renders all result tabs and high-confidence evidence", () => {
    const html = renderToStaticMarkup(<StegoResultsPanel analysis={analysis()} onTab={() => undefined} onExport={() => undefined} />);
    for (const label of ["总览", "元数据", "结构", "字符串", "可视化", "DCT", "雕刻文件"]) expect(html).toContain(label);
    expect(html).toContain("ctfshow{result}");
    expect(html).toContain("0x2a");
  });

  it("switches tabs and exports carved files", () => {
    const onTab = vi.fn();
    const onExport = vi.fn();
    const current = analysis();
    current.selectedTab = "files";
    const renderer = create(<StegoResultsPanel analysis={current} onTab={onTab} onExport={onExport} />);
    act(() => renderer.root.findByProps({ "aria-label": "查看元数据" }).props.onClick());
    expect(onTab).toHaveBeenCalledWith("metadata");
    act(() => renderer.root.findByProps({ "aria-label": "导出 payload.zip" }).props.onClick());
    expect(onExport).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3), "payload.zip", "application/zip");
  });
});
