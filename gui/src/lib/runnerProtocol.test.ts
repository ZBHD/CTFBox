import { describe, expect, it } from "vitest";
import { createToolRunRequest } from "./runnerProtocol";

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
});
