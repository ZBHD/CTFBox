import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CryptoWorkbench } from "./CryptoWorkbench";

describe("CryptoWorkbench", () => {
  it("uses a direct input/output processing layout without a terminal", () => {
    const html = renderToStaticMarkup(
      <CryptoWorkbench mode="encoding" parameters={{}} onChange={() => undefined} onClear={() => undefined} />,
    );

    expect(html).toContain("输入");
    expect(html).toContain("输出");
    expect(html).toContain("Base64");
    expect(html).not.toContain("命令终端");
  });

  it("shows automatic decoded candidates and the expanded codec set", () => {
    const html = renderToStaticMarkup(
      <CryptoWorkbench mode="encoding" parameters={{ input: "MZXW6===" }} flagPrefixes={["flag", "CTF"]} onChange={() => undefined} onClear={() => undefined} />,
    );

    expect(html).toContain("Base32");
    expect(html).toContain("自动解码");
    expect(html).toContain("foo");
  });
});
