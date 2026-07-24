import { describe, expect, it } from "vitest";
import { buildCommand } from "./commandBuilder";

describe("command builder", () => {
  it("builds a SQLmap database enumeration command from selected parameters", () => {
    expect(
      buildCommand("sqlmap", "original", {
        url: "http://127.0.0.1/item?id=1",
        dbs: true,
        tables: false,
        columns: false,
      }),
    ).toEqual(["sqlmap.cmd", "--url", "http://127.0.0.1/item?id=1", "--dbs"]);
  });

  it("builds grouped SQLmap request, detection, and enumeration parameters", () => {
    expect(
      buildCommand("sqlmap", "cn", {
        url: "http://127.0.0.1/item?id=1",
        method: "POST",
        data: "id=1",
        cookie: "session=test",
        level: 3,
        risk: 2,
        technique: "BEU",
        database: "main",
        table: "users",
        dump: true,
        threads: 4,
        batch: true,
      }),
    ).toEqual([
      "sqlmap.cmd", "-cn", "--url", "http://127.0.0.1/item?id=1",
      "--method", "POST", "--data", "id=1", "--cookie", "session=test",
      "--level", "3", "--risk", "2", "--technique", "BEU",
      "-D", "main", "-T", "users", "--dump", "--threads", "4", "--batch",
    ]);
  });

  it("builds SSTImap request, crawler, and detection parameters", () => {
    expect(
      buildCommand("sstimap", "original", {
        url: "http://127.0.0.1/page?name=*",
        method: "POST",
        data: "name=*",
        injectionPoints: "QB",
        crawlDepth: 2,
        forms: true,
        engine: "jinja2",
        technique: "RE",
        level: 3,
      }),
    ).toEqual([
      "sstimap.cmd", "-u", "http://127.0.0.1/page?name=*", "-m", "POST",
      "-d", "name=*", "-P", "QB", "-c", "2", "-f",
      "-l", "3", "-e", "jinja2", "-r", "RE",
    ]);
  });
});
