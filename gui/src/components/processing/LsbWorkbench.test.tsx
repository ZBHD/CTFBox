import { useState } from "react";
import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LSB_PARAMETERS } from "../../lib/lsbEngine";
import type { LsbLocalAnalysis } from "../../lib/lsbTypes";
import { LsbWorkbench } from "./LsbWorkbench";
import { LsbParameterPanel } from "./lsb/LsbParameterPanel";

function analysis(): LsbLocalAnalysis {
  return {
    kind: "lsb",
    status: "idle",
    mode: "auto",
    depth: "quick",
    parameters: DEFAULT_LSB_PARAMETERS,
    candidates: [],
  };
}

describe("LsbWorkbench", () => {
  it("renders automatic and complete manual workflows", () => {
    const html = renderToStaticMarkup(
      <LsbWorkbench
        analysis={analysis()}
        flagPrefixes={["ctfshow"]}
        flagCaseSensitive={false}
        flagEnabled
        onAnalysisChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(html).toContain("自动分析");
    expect(html).toContain("手动提取");
    expect(html).toContain("快速扫描");
    expect(html).toContain("深度扫描");
    expect(html).toContain("数据源顺序");
  });

  it("edits ordered source tokens without losing parameter state", () => {
    function Harness() {
      const [value, setValue] = useState<LsbLocalAnalysis>({ ...analysis(), mode: "manual" });
      return <LsbParameterPanel analysis={value} disabled={false} onChange={setValue} />;
    }

    const renderer = create(<Harness />);
    const root = renderer.root;
    const bitSelect = root.findByProps({ "aria-label": "新数据源位" });
    act(() => bitSelect.props.onChange({ target: { value: "4" } }));
    act(() => root.findByProps({ title: "添加数据源" }).props.onClick());

    expect(root.findAllByProps({ className: "lsb-token-label" }).map((node) => node.children.join(""))).toEqual(["R0", "G0", "B0", "R4"]);
    act(() => root.findAllByProps({ title: "左移数据源" }).at(-1)?.props.onClick());
    expect(root.findAllByProps({ className: "lsb-token-label" }).map((node) => node.children.join(""))).toEqual(["R0", "G0", "R4", "B0"]);
    act(() => root.findAllByProps({ title: "删除数据源" }).at(-1)?.props.onClick());
    expect(root.findAllByProps({ className: "lsb-token-label" }).map((node) => node.children.join(""))).toEqual(["R0", "G0", "R4"]);
  });

  it("rejects an oversized image before reading it into memory", () => {
    const onChange = vi.fn();
    const arrayBuffer = vi.fn();
    const renderer = create(
      <LsbWorkbench analysis={analysis()} flagPrefixes={["flag"]} flagCaseSensitive={false} flagEnabled onAnalysisChange={onChange} onClear={() => undefined} />,
    );

    const fileInput = renderer.root.findAllByType("input").find((node) => node.props.type === "file");
    act(() => fileInput?.props.onChange({
      target: { files: [{ name: "huge.png", size: 65 * 1024 * 1024, type: "image/png", arrayBuffer }] },
    }));

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("64 MiB") }));
  });
});
