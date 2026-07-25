import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ParameterPanel } from "./ParameterPanel";

describe("ParameterPanel", () => {
  it("marks sample input placeholders as examples", () => {
    const html = renderToStaticMarkup(
      <ParameterPanel toolId="sqlmap" parameters={{}} onChange={() => undefined} />,
    );

    expect(html).toContain('placeholder="例如：http://127.0.0.1/item?id=1"');
    expect(html).toContain('placeholder="例如：id=1&amp;name=test"');
  });

  it("renders real SQLmap groups, search, and result-linked selectors", () => {
    const html = renderToStaticMarkup(
      <ParameterPanel
        toolId="sqlmap"
        parameters={{ url: "http://127.0.0.1/item?id=1" }}
        findings={[
          { kind: "database", value: "main" },
          { kind: "database", value: "archive" },
        ]}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("搜索参数或命令标志");
    expect(html).toContain("常用");
    expect(html).toContain("请求");
    expect(html).toContain("注入");
    expect(html).toContain("检测");
    expect(html).toContain("枚举");
    expect(html).toContain("2 个已发现");
    expect(html).toContain("--url");
  });

  it("keeps every boolean input inside its visible parameter control", () => {
    const html = renderToStaticMarkup(
      <ParameterPanel toolId="sqlmap" parameters={{}} onChange={() => undefined} />,
    );
    const checkboxTags = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

    expect(checkboxTags.length).toBeGreaterThan(0);
    expect(checkboxTags.every((tag) => tag.includes('class="parameter-toggle-input"'))).toBe(true);
  });

  it("opens the native file picker and stores the selected path", async () => {
    const onChange = vi.fn();
    const openFileDialog = vi.fn().mockResolvedValue("C:\\fixtures\\sqlmap.ini");
    const panel = create(
      <ParameterPanel
        toolId="sqlmap"
        parameters={{}}
        onChange={onChange}
        {...{ openFileDialog }}
      />,
    );

    act(() => {
      panel.root.findAllByType("button").find((button) => button.props.children === "目标")?.props.onClick();
    });
    const fileButtons = panel.root.findAllByProps({ title: "选择文件" });

    await act(async () => {
      await fileButtons[2]?.props.onClick?.();
    });

    expect(openFileDialog).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("configFile", "C:\\fixtures\\sqlmap.ini");
  });
});
