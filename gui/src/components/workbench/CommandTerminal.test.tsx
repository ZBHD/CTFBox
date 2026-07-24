import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommandRun } from "../../state/taskStore";
import type { FlagHit } from "../../lib/flagDetector";
import { CommandTerminal } from "./CommandTerminal";

const runs: CommandRun[] = [
  {
    id: "run-1",
    argv: ["sqlmap.py", "--dbs"],
    status: "completed",
    output: "available databases: main",
    collapsed: true,
  },
  {
    id: "run-2",
    argv: ["sqlmap.py", "-D", "main", "--tables"],
    status: "running",
    output: "fetching tables",
    collapsed: false,
  },
];

describe("CommandTerminal", () => {
  it("keeps previous commands and output when a later command is rendered", () => {
    const html = renderToStaticMarkup(
      <CommandTerminal runs={runs} commandPreview="sqlmap.py -D main --tables" />,
    );

    expect(html).toContain("available databases: main");
    expect(html).toContain("fetching tables");
    expect(html).toContain("run-1");
    expect(html).toContain("run-2");
  });

  it("highlights plain flags and their Base64 source token in terminal output", () => {
    const hits: FlagHit[] = [
      { text: "flag{plain}", source: "plain" },
      { text: "flag{encoded}", source: "base64", encoded: "ZmxhZ3tlbmNvZGVkfQ==" },
    ];
    const html = renderToStaticMarkup(
      <CommandTerminal
        runs={[{ ...runs[0], collapsed: false, output: "flag{plain} ZmxhZ3tlbmNvZGVkfQ==" }]}
        commandPreview="sqlmap.py"
        flagHits={hits}
      />,
    );

    expect(html.match(/<mark>/g)?.length).toBe(2);
  });

  it("shows a stdin input control while a run is active", () => {
    const html = renderToStaticMarkup(
      <CommandTerminal runs={runs} commandPreview="sqlmap.py -D main --tables" runningRunId="run-2" onSendInput={() => undefined} />,
    );

    expect(html).toContain("发送输入");
  });
});
