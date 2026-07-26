import { describe, expect, it } from "vitest";
import { getPlugin, listPlugins } from "./pluginRegistry";

describe("tool plugin registry", () => {
  it("returns stable category order and the four initial tools", () => {
    expect(listPlugins().map((plugin) => plugin.id)).toEqual([
      "sqlmap",
      "sstimap",
      "crypto",
      "misc",
    ]);
  });

  it("exposes SQLmap as a selectable original or Chinese edition tool", () => {
    expect(getPlugin("sqlmap")).toMatchObject({
      category: "web",
      editions: ["original", "cn"],
      runner: {
        launcher: "sqlmap.cmd",
        sourceDirectory: "sqlmap-1.10",
        entry: "sqlmap.py",
      },
    });
  });
});
