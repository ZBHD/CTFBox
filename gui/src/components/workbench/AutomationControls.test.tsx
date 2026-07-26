import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AutomationControls } from "./AutomationControls";

describe("AutomationControls", () => {
  it("shows queue progress and exposes a stop action while automation is running", () => {
    const html = renderToStaticMarkup(
      <AutomationControls
        phase="running"
        concurrency={3}
        active={2}
        started={5}
        onConcurrencyChange={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain("自动找 Flag");
    expect(html).toContain("2 个并发任务");
    expect(html).toContain("已启动 5 个任务");
    expect(html).toContain("停止自动化");
  });

  it("reports a failed automation queue instead of completion", () => {
    const html = renderToStaticMarkup(
      <AutomationControls
        phase="failed"
        concurrency={3}
        active={0}
        started={1}
        onConcurrencyChange={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain("自动化失败");
    expect(html).not.toContain("自动化完成");
  });
});
