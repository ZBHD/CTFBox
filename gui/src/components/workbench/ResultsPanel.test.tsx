import { act, create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { TaskSuggestion } from "../../lib/suggestionEngine";
import { ResultsPanel } from "./ResultsPanel";

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child))
    .join("");
}

const suggestion: TaskSuggestion = {
  id: "next",
  label: "枚举 app 的数据表",
  patch: { database: "app", tables: true },
  commandPreview: "sqlmap.cmd --url TARGET_URL -D app --tables",
};

describe("ResultsPanel suggestions", () => {
  it("shows the command preview and applies the selected suggestion", () => {
    const onApplySuggestion = vi.fn();
    const panel = create(
      <ResultsPanel
        findings={[]}
        suggestions={[suggestion]}
        running={false}
        onApplySuggestion={onApplySuggestion}
        flagEnabled={false}
        flagPrefixes={[]}
      />,
    );

    expect(textContent(panel.root)).toContain(suggestion.label);
    expect(textContent(panel.root)).toContain(suggestion.commandPreview);
    const action = panel.root.findByProps({ "aria-label": `执行建议：${suggestion.label}` });
    act(() => action.props.onClick());
    expect(onApplySuggestion).toHaveBeenCalledWith(suggestion);
  });

  it("keeps the next-step action ahead of a long findings list", () => {
    const panel = create(
      <ResultsPanel
        findings={[
          { kind: "injection-point", value: "id" },
          { kind: "database", value: "app" },
          { kind: "table", value: "users", database: "app" },
        ]}
        suggestions={[suggestion]}
        running={false}
        onApplySuggestion={() => undefined}
        flagEnabled={false}
        flagPrefixes={[]}
      />,
    );

    const content = textContent(panel.root);
    expect(content.indexOf("下一步")).toBeLessThan(content.indexOf("injection-point"));
  });

  it("disables suggestion execution while the task is running", () => {
    const panel = create(
      <ResultsPanel
        findings={[]}
        suggestions={[suggestion]}
        running
        onApplySuggestion={() => undefined}
        flagEnabled={false}
        flagPrefixes={[]}
      />,
    );

    expect(panel.root.findByProps({ "aria-label": `执行建议：${suggestion.label}` }).props.disabled).toBe(true);
  });
});
