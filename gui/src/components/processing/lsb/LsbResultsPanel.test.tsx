import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LSB_PARAMETERS } from "../../../lib/lsbEngine";
import type { LsbCandidate, LsbLocalAnalysis } from "../../../lib/lsbTypes";
import { LsbResultsPanel } from "./LsbResultsPanel";

const candidate: LsbCandidate = {
  id: "top",
  score: 220,
  parameters: DEFAULT_LSB_PARAMETERS,
  preview: "ctfshow{result}",
  mediaType: "application/zip",
  evidence: ["发现 Flag：ctfshow{result}", "识别到 ZIP 文件（偏移 0）"],
  bytes: Uint8Array.from([0x63, 0x74, 0x66]),
  files: [{
    name: "carved-0.zip",
    mediaType: "application/zip",
    offset: 0,
    bytes: Uint8Array.from([0x50, 0x4b]),
    children: [{
      name: "旗子",
      mediaType: "text/plain",
      offset: 0,
      bytes: new TextEncoder().encode("ctfshow{inside}"),
      text: "ctfshow{inside}",
    }],
  }],
};

function analysis(): LsbLocalAnalysis {
  return {
    kind: "lsb",
    status: "completed",
    fileName: "challenge.png",
    mode: "auto",
    depth: "quick",
    parameters: DEFAULT_LSB_PARAMETERS,
    candidates: [candidate],
    selectedId: candidate.id,
  };
}

describe("LsbResultsPanel", () => {
  it("renders ranked candidates, evidence and archive children", () => {
    const html = renderToStaticMarkup(<LsbResultsPanel analysis={analysis()} onSelect={() => undefined} onApply={() => undefined} onExport={() => undefined} />);

    expect(html).toContain("#1");
    expect(html).toContain("220 分");
    expect(html).toContain("R0,G0,B0");
    expect(html).toContain("ctfshow{result}");
    expect(html).toContain("旗子");
    expect(html).toContain("ctfshow{inside}");
  });

  it("switches previews and invokes apply/export commands", () => {
    const onApply = vi.fn();
    const onExport = vi.fn();
    const renderer = create(<LsbResultsPanel analysis={analysis()} onSelect={() => undefined} onApply={onApply} onExport={onExport} />);
    const root = renderer.root;

    act(() => root.findByProps({ title: "查看 Hex" }).props.onClick());
    expect(root.findByProps({ className: "lsb-result-hex" }).children.join("")).toContain("63 74 66");
    act(() => root.findByProps({ title: "应用参数" }).props.onClick());
    act(() => root.findByProps({ title: "导出原始字节" }).props.onClick());

    expect(onApply).toHaveBeenCalledWith(candidate);
    expect(onExport).toHaveBeenCalledWith(candidate.bytes, expect.stringContaining("challenge"), "application/zip");
  });

  it("renders a useful empty and failed state", () => {
    const empty = renderToStaticMarkup(<LsbResultsPanel analysis={{ ...analysis(), status: "idle", candidates: [], selectedId: undefined }} onSelect={() => undefined} onApply={() => undefined} onExport={() => undefined} />);
    const failed = renderToStaticMarkup(<LsbResultsPanel analysis={{ ...analysis(), status: "failed", candidates: [], error: "图片损坏" }} onSelect={() => undefined} onApply={() => undefined} onExport={() => undefined} />);

    expect(empty).toContain("运行后显示候选数据");
    expect(failed).toContain("图片损坏");
  });
});
