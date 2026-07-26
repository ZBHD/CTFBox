import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FakeEncryptionWorkbench } from "./FakeEncryptionWorkbench";
import { FakeEncParameterPanel } from "./fakeenc/FakeEncParameterPanel";
import { DEFAULT_ZIP_OPTIONS, type ZipLocalAnalysis } from "../../lib/zipTypes";

function analysis(): ZipLocalAnalysis {
  return { kind: "zip", status: "idle", options: { ...DEFAULT_ZIP_OPTIONS } };
}

describe("FakeEncryptionWorkbench", () => {
  it("renders file, parameter and result surfaces", () => {
    const html = renderToStaticMarkup(<FakeEncryptionWorkbench analysis={analysis()} flagPrefixes={["flag"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={() => undefined} onClear={() => undefined} />);
    expect(html).toContain("伪加密");
    expect(html).toContain("本地文件头");
    expect(html).toContain("中央目录");
    expect(html).toContain("检测并修复");
  });

  it("toggles detection options without mutating previous state", () => {
    const onChange = vi.fn();
    const current = analysis();
    const renderer = create(<FakeEncParameterPanel analysis={current} disabled={false} onChange={onChange} />);
    const local = renderer.root.findByProps({ "aria-label": "检查本地文件头" });
    act(() => local.props.onChange({ target: { checked: false } }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ checkLocalHeader: false }) }));
    expect(current.options.checkLocalHeader).toBe(true);
  });

  it("rejects an oversized archive before reading it into memory", () => {
    const onChange = vi.fn();
    const arrayBuffer = vi.fn();
    const renderer = create(<FakeEncryptionWorkbench analysis={analysis()} flagPrefixes={["flag"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={onChange} onClear={() => undefined} />);
    act(() => renderer.root.findByProps({ "aria-label": "选择伪加密分析文件" }).props.onChange({
      target: { files: [{ name: "huge.zip", size: 129 * 1024 * 1024, type: "application/zip", arrayBuffer }] },
    }));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("128 MiB") }));
  });
});
