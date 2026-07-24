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
    expect(html).toContain("位平面");
    expect(html).toContain("颜色通道");
    expect(html).toContain("提取顺序");
  });

  it("renders audio analysis controls", () => {
    const html = renderMode("audio");
    expect(html).toContain("波形");
    expect(html).toContain("频谱");
    expect(html).toContain("声道");
  });
});
