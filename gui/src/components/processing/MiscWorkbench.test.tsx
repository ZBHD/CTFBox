import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiscWorkbench } from "./MiscWorkbench";

const renderMode = (mode: string) => renderToStaticMarkup(
  <MiscWorkbench mode={mode} parameters={{}} onChange={() => undefined} onClear={() => undefined} />,
);

describe("MiscWorkbench", () => {
  it("renders dedicated pseudo-encryption controls", () => {
    const html = renderMode("fake-encryption");
    expect(html).toContain("ZIP 加密标记");
    expect(html).toContain("检测并修复");
    expect(html).not.toContain("命令终端");
  });

  it("renders image-specific LSB controls", () => {
    const html = renderMode("lsb");
    expect(html).toContain("自动分析");
    expect(html).toContain("手动提取");
    expect(html).toContain("数据源顺序");
    expect(html).not.toContain("等待分析适配器返回结果");
  });

  it("renders the dedicated image and file steganography workbench", () => {
    const html = renderMode("image");
    expect(html).toContain("图片 / 文件隐写");
    expect(html).toContain("文件结构");
    expect(html).toContain("二维 FFT");
    expect(html).toContain("雕刻文件");
    expect(html).not.toContain("等待分析适配器返回结果");
  });

  it("renders audio analysis controls", () => {
    const html = renderMode("audio");
    expect(html).toContain("波形");
    expect(html).toContain("频谱");
    expect(html).toContain("声道");
  });
});
