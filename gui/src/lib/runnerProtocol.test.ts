import { describe, expect, it } from "vitest";
import { createToolRunRequest } from "./runnerProtocol";
import { listPlugins } from "./pluginRegistry";

describe("tool runner protocol", () => {
  it("sends controlled tool arguments without an executable path", () => {
    expect(createToolRunRequest("run-1", "sqlmap", "cn", ["sqlmap.cmd", "-cn", "-u", "http://target"])).toEqual({
      runId: "run-1",
      toolId: "sqlmap",
      edition: "cn",
      arguments: ["-u", "http://target"],
    });
  });

  it("rejects a command for another tool", () => {
    expect(() => createToolRunRequest("run-1", "sstimap", "original", ["sqlmap.cmd", "-h"])).toThrow("命令与工具不匹配");
  });

  it("accepts every runnable tool declared by the shared registry", () => {
    const runnable = listPlugins().filter((plugin) => plugin.runner);
    expect(runnable.map((plugin) => plugin.id)).toEqual(["sqlmap", "sstimap"]);
    for (const plugin of runnable) {
      const request = createToolRunRequest(
        `run-${plugin.id}`,
        plugin.id,
        "original",
        [plugin.runner!.launcher, "--help"],
      );
      expect(request.toolId).toBe(plugin.id);
      expect(request.arguments).toEqual(["--help"]);
    }
  });
});
