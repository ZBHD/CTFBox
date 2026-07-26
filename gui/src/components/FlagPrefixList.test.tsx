import { act, create, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_FLAG_PREFIXES,
  DEFAULT_FLAG_PREFIX_PREFERENCE,
  type FlagPrefixPreference,
} from "../lib/flagPrefixPreference";
import { FlagPrefixList } from "./FlagPrefixList";

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : textContent(child))
    .join("");
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType("button").find((button) => textContent(button).includes(label));
}

function renderList(
  preference: FlagPrefixPreference = DEFAULT_FLAG_PREFIX_PREFERENCE,
  onChange = vi.fn(),
) {
  return {
    onChange,
    renderer: create(<FlagPrefixList value={preference} onChange={onChange} />),
  };
}

describe("FlagPrefixList", () => {
  it("renders 45 enabled built-ins without source or type columns", () => {
    const html = renderToStaticMarkup(
      <FlagPrefixList value={DEFAULT_FLAG_PREFIX_PREFERENCE} onChange={() => undefined} />,
    );

    expect(BUILT_IN_FLAG_PREFIXES).toHaveLength(45);
    expect((html.match(/class="flag-prefix-item"/g) ?? [])).toHaveLength(45);
    expect(html).toContain("45 个检测头");
    expect(html).toContain("NSSCTF");
    expect(html).not.toContain("来源");
    expect(html).not.toContain("类型");
  });

  it("filters prefixes using the search field", () => {
    const { renderer } = renderList();
    const search = renderer.root.findByProps({ "aria-label": "搜索 Flag 头" });

    act(() => search.props.onChange({ target: { value: "nss" } }));

    const prefixes = renderer.root.findAllByType("code").map(textContent);
    expect(prefixes).toEqual(["NSSCTF"]);
    expect(textContent(renderer.root)).toContain("1 个结果");
  });

  it("toggles one prefix and all prefixes", () => {
    const single = renderList();
    act(() => single.renderer.root.findByProps({ "aria-label": "禁用 NSSCTF" }).props.onClick());
    expect(single.onChange).toHaveBeenCalledWith({
      enabled: DEFAULT_FLAG_PREFIX_PREFERENCE.enabled.filter((prefix) => prefix !== "NSSCTF"),
      custom: [],
    });

    const all = renderList();
    act(() => all.renderer.root.findByProps({ "aria-label": "禁用全部检测头" }).props.onClick());
    expect(all.onChange).toHaveBeenCalledWith({ enabled: [], custom: [] });
  });

  it("adds a trimmed custom prefix from the inline form", () => {
    const { renderer, onChange } = renderList();
    act(() => findButton(renderer.root, "添加")?.props.onClick());
    const input = renderer.root.findByProps({ "aria-label": "自定义检测头" });
    act(() => input.props.onChange({ target: { value: "  TEAM  " } }));
    act(() => renderer.root.findByType("form").props.onSubmit({ preventDefault: () => undefined }));

    expect(onChange).toHaveBeenCalledWith({
      enabled: [...DEFAULT_FLAG_PREFIX_PREFERENCE.enabled, "TEAM"],
      custom: ["TEAM"],
    });
  });

  it("submits a custom prefix with Enter", () => {
    const { renderer, onChange } = renderList();
    act(() => findButton(renderer.root, "添加")?.props.onClick());
    const input = renderer.root.findByProps({ "aria-label": "自定义检测头" });
    act(() => input.props.onChange({ target: { value: "TEAM" } }));
    act(() => input.props.onKeyDown({ key: "Enter", preventDefault: () => undefined }));

    expect(onChange).toHaveBeenCalledWith({
      enabled: [...DEFAULT_FLAG_PREFIX_PREFERENCE.enabled, "TEAM"],
      custom: ["TEAM"],
    });
  });

  it.each([
    ["", "请输入检测头"],
    ["bad{head", "不要包含逗号、花括号或空白"],
    ["bad head", "不要包含逗号、花括号或空白"],
    ["flag", "该检测头已存在"],
    ["FLAG", "该检测头已存在"],
  ])("rejects invalid custom prefix %j", (draft, message) => {
    const { renderer, onChange } = renderList();
    act(() => findButton(renderer.root, "添加")?.props.onClick());
    const input = renderer.root.findByProps({ "aria-label": "自定义检测头" });
    act(() => input.props.onChange({ target: { value: draft } }));
    act(() => renderer.root.findByType("form").props.onSubmit({ preventDefault: () => undefined }));

    expect(textContent(renderer.root.findByProps({ role: "alert" }))).toContain(message);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a custom prefix from the inventory and enabled values", () => {
    const { renderer, onChange } = renderList({
      enabled: [...DEFAULT_FLAG_PREFIX_PREFERENCE.enabled, "TEAM"],
      custom: ["TEAM"],
    });

    act(() => renderer.root.findByProps({ "aria-label": "删除 TEAM" }).props.onClick());

    expect(onChange).toHaveBeenCalledWith({
      enabled: [...DEFAULT_FLAG_PREFIX_PREFERENCE.enabled],
      custom: [],
    });
  });
});
