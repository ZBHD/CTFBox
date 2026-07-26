import { describe, expect, it } from "vitest";
import { getPlugin, listPlugins, runnerCommandName } from "./pluginRegistry";

describe("tool plugin registry", () => {
  it("returns stable category order including the new web tools", () => {
    expect(listPlugins().map((plugin) => plugin.id)).toEqual([
      "sqlmap",
      "sstimap",
      "dirsearch",
      "subfinder",
      "nuclei",
      "webshell",
      "crypto",
      "misc",
    ]);
  });

  it("exposes SQLmap as a selectable original or Chinese edition tool", () => {
    expect(getPlugin("sqlmap")).toMatchObject({
      category: "web",
      capabilities: ["flag-hunt"],
      editions: ["original", "cn"],
      runner: {
        kind: "python",
        launcher: "sqlmap.cmd",
        sourceDirectory: "sqlmap-1.10",
        entry: "sqlmap.py",
      },
    });
  });

  it("only declares automatic Flag hunting for tools with a real automation plan", () => {
    expect(getPlugin("sstimap")).toMatchObject({ capabilities: ["flag-hunt"] });
    for (const toolId of ["dirsearch", "subfinder", "nuclei", "webshell"]) {
      expect(getPlugin(toolId)).not.toMatchObject({ capabilities: ["flag-hunt"] });
    }
  });

  it("parses the binary and session runner variants", () => {
    expect(getPlugin("subfinder")?.runner).toEqual({ kind: "binary", program: "subfinder" });
    expect(getPlugin("webshell")?.runner).toEqual({ kind: "session", sourceDirectory: "webshell", entry: "webshell.py" });
  });

  it("derives the argv[0] command name per runner kind", () => {
    expect(runnerCommandName(getPlugin("dirsearch"))).toBe("dirsearch.cmd");
    expect(runnerCommandName(getPlugin("subfinder"))).toBe("subfinder");
    expect(runnerCommandName(getPlugin("webshell"))).toBeUndefined();
    expect(runnerCommandName(getPlugin("crypto"))).toBeUndefined();
  });
});
