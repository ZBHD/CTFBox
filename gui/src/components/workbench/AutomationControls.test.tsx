import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AutomationControls } from "./AutomationControls";

describe("AutomationControls", () => {
  it("shows queue progress and exposes a stop action while automation is running", () => {
    const html = renderToStaticMarkup(
      <AutomationControls
        toolId="sqlmap"
        phase="running"
        concurrency={3}
        timeoutSeconds={180}
        maxSqlmapDumps={10}
        databaseScope="app"
        active={2}
        started={5}
        onConcurrencyChange={vi.fn()}
        onTimeoutChange={vi.fn()}
        onMaxSqlmapDumpsChange={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain("自动找 Flag");
    expect(html).toContain("2 个并发任务");
    expect(html).toContain("已启动 5 个任务");
    expect(html).toContain("时限");
    expect(html).toContain("导出上限");
    expect(html).toContain("数据库：app");
    expect(html).toContain("停止自动化");
  });

  it("reports a failed automation queue instead of completion", () => {
    const html = renderToStaticMarkup(
      <AutomationControls
        toolId="sstimap"
        phase="failed"
        concurrency={3}
        timeoutSeconds={180}
        maxSqlmapDumps={10}
        active={0}
        started={1}
        onConcurrencyChange={vi.fn()}
        onTimeoutChange={vi.fn()}
        onMaxSqlmapDumpsChange={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain("自动化失败");
    expect(html).not.toContain("自动化完成");
  });
});
