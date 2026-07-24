import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlagHitStrip } from "./FlagHitStrip";

describe("FlagHitStrip", () => {
  it("shows the decoded flag without a global-hit sentence", () => {
    const html = renderToStaticMarkup(
      <FlagHitStrip hits={[{ text: "flag{crypto}", source: "base64", encoded: "ZmxhZ3tjcnlwdG99" }]} />,
    );

    expect(html).toContain("flag{crypto}");
    expect(html).toContain("Base64");
    expect(html).not.toContain("全局");
    expect(html).not.toContain("命中");
  });
});
