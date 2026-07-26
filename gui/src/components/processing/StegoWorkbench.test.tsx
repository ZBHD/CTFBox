import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STEGO_OPTIONS } from "../../lib/stegoAnalyzer";
import type { StegoLocalAnalysis } from "../../lib/stegoTypes";
import { StegoWorkbench } from "./StegoWorkbench";
import { StegoParameterPanel } from "./stego/StegoParameterPanel";

function analysis(): StegoLocalAnalysis {
  return { kind: "stego", status: "idle", options: { ...DEFAULT_STEGO_OPTIONS }, selectedTab: "overview" };
}

describe("StegoWorkbench", () => {
  it("renders dedicated file, parameter and result surfaces", () => {
    const html = renderToStaticMarkup(<StegoWorkbench analysis={analysis()} flagPrefixes={["ctfshow"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={() => undefined} onClear={() => undefined} />);
    expect(html).toContain("输入文件与原图");
    expect(html).toContain("文件结构");
    expect(html).toContain("JPEG DCT");
    expect(html).toContain("总览");
    expect(html).toContain("雕刻文件");
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

    act(() => renderer.root.findByProps({ "aria-label": "选择隐写分析文件" }).props.onChange({
      target: { files: [{ name: "huge.bin", size: 129 * 1024 * 1024, type: "application/octet-stream", arrayBuffer }] },
    }));

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("128 MiB") }));
  });
});
