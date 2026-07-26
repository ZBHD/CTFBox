import { describe, expect, it } from "vitest";
import { createToolRunRequest } from "./runnerProtocol";
import { listPlugins, runnerCommandName } from "./pluginRegistry";

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

  it("sends a native binary scanner command without the program name", () => {
    expect(createToolRunRequest("run-2", "subfinder", "original", ["subfinder", "-d", "example.com", "-oJ"])).toEqual({
      runId: "run-2",
      toolId: "subfinder",
      edition: "original",
      arguments: ["-d", "example.com", "-oJ"],
    });
  });

  it("rejects command-line invocation for session tools", () => {
    expect(() => createToolRunRequest("run-3", "webshell", "original", ["webshell"])).toThrow("不支持命令行调用");
  });

  it("accepts every command-line runnable tool declared by the shared registry", () => {
    const runnable = listPlugins().filter((plugin) => runnerCommandName(plugin));
    expect(runnable.map((plugin) => plugin.id)).toEqual(["sqlmap", "sstimap", "dirsearch", "subfinder", "nuclei"]);
    for (const plugin of runnable) {
      const request = createToolRunRequest(
        `run-${plugin.id}`,
        plugin.id,
        "original",
        [runnerCommandName(plugin)!, "--help"],
      );
      expect(request.toolId).toBe(plugin.id);
      expect(request.arguments).toEqual(["--help"]);
    }
  });
});
