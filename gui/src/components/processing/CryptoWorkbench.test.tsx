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

  it("groups codec options by family in a predictable order", () => {
    const html = renderToStaticMarkup(
      <CryptoWorkbench mode="encoding" parameters={{}} onChange={() => undefined} onClear={() => undefined} />,
    );

    expect(html).toContain('<optgroup label="Base 编码">');
    expect(html).toContain('<optgroup label="进制表示">');
    expect(html).toContain('<optgroup label="文本转义">');
    expect(html.indexOf('label="Base 编码"')).toBeLessThan(html.indexOf('label="进制表示"'));
    expect(html.indexOf('label="进制表示"')).toBeLessThan(html.indexOf('label="文本转义"'));
    expect(html.indexOf('value="base64"')).toBeLessThan(html.indexOf('value="base32"'));
    expect(html.indexOf('value="hex"')).toBeLessThan(html.indexOf('value="binary"'));
    expect(html.indexOf('value="url"')).toBeLessThan(html.indexOf('value="html"'));
  });
});
