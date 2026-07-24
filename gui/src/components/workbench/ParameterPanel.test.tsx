import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParameterPanel } from "./ParameterPanel";

describe("ParameterPanel", () => {
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
});
