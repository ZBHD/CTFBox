import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ParameterPanel } from "./ParameterPanel";

function textContent(node: { children: Array<string | { children: unknown[] }> }): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child as { children: Array<string | { children: unknown[] }> }))
    .join("");
}

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

  it("filters discovered tables and columns by the selected context", () => {
    const panel = create(
      <ParameterPanel
        toolId="sqlmap"
        parameters={{ database: "app", table: "users" }}
        findings={[
          { kind: "database", value: "app" },
          { kind: "database", value: "audit" },
          { kind: "table", value: "users", database: "app" },
          { kind: "table", value: "events", database: "audit" },
          { kind: "column", value: "name", database: "app", table: "users" },
          { kind: "column", value: "total", database: "app", table: "orders" },
          { kind: "column", value: "token", database: "audit", table: "users" },
        ]}
        onChange={() => undefined}
      />,
    );

    act(() => {
      panel.root.findAllByType("button").find((item) => textContent(item).trim() === "枚举")?.props.onClick();
    });
    const triggers = panel.root.findAllByProps({ title: "选择已发现结果" });

    act(() => triggers[1].props.onClick());
    const tableMenu = panel.root.findAllByProps({ role: "listbox" })[0];
    expect(textContent(tableMenu)).toContain("users");
    expect(textContent(tableMenu)).not.toContain("events");

    act(() => triggers[2].props.onClick());
    const columnMenu = panel.root.findAllByProps({ role: "listbox" }).at(-1)!;
    expect(textContent(columnMenu)).toContain("name");
    expect(textContent(columnMenu)).not.toContain("total");
    expect(textContent(columnMenu)).not.toContain("token");
  });

  it("keeps manual result input when the selected context has no findings", () => {
    const panel = create(
      <ParameterPanel
        toolId="sqlmap"
        parameters={{ database: "app" }}
        findings={[{ kind: "table", value: "events", database: "audit" }]}
        onChange={() => undefined}
      />,
    );

    act(() => {
      panel.root.findAllByType("button").find((item) => textContent(item).trim() === "枚举")?.props.onClick();
    });

    expect(panel.root.findAllByProps({ placeholder: "选择或输入数据表" })).toHaveLength(1);
  });

  it("keeps manual entry available alongside discovered result options", () => {
    const onChange = vi.fn();
    const panel = create(
      <ParameterPanel
        toolId="sqlmap"
        parameters={{}}
        findings={[{ kind: "database", value: "app" }]}
        onChange={onChange}
      />,
    );

    act(() => {
      panel.root.findAllByType("button").find((item) => textContent(item).trim() === "枚举")?.props.onClick();
    });
    const manualInput = panel.root.findAllByType("input")
      .find((item) => item.props.placeholder === "选择或输入数据库");
    expect(manualInput).toBeDefined();
    act(() => manualInput!.props.onChange({ target: { value: "manual_db" } }));

    expect(onChange).toHaveBeenCalledWith("database", "manual_db");
    expect(panel.root.findAllByProps({ title: "选择已发现结果" })).toHaveLength(1);
  });
});
