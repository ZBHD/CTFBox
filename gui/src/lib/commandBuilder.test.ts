import { describe, expect, it } from "vitest";
import { buildCommand } from "./commandBuilder";

describe("command builder", () => {
  it("builds a SQLmap database enumeration command from selected parameters", () => {
    expect(
      buildCommand("sqlmap", "original", {
        url: "http://127.0.0.1/item?id=1",
        database: true,
        tables: false,
        columns: false,
      }),
    ).toEqual(["sqlmap.cmd", "--url", "http://127.0.0.1/item?id=1", "--dbs"]);
  });
});
