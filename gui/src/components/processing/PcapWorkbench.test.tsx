import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PcapWorkbench } from "./PcapWorkbench";

describe("PcapWorkbench", () => {
  it("renders a dedicated capture analysis surface", () => {
    const html = renderToStaticMarkup(<PcapWorkbench onAnalysisChange={() => undefined} onClear={() => undefined} />);

    expect(html).toContain("PCAP 分析");
    expect(html).toContain("经典 PCAP");
    expect(html).toContain("数据包概览");
  });
});
