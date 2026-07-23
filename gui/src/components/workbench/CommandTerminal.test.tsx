import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommandRun } from "../../state/taskStore";
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
});
