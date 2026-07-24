import { describe, expect, it } from "vitest";
import { getToolSchema } from "./toolSchemas";

describe("web tool parameter schemas", () => {
  it("covers SQLmap workflow groups and result-linked enumeration fields", () => {
    const schema = getToolSchema("sqlmap");

    expect(schema.groups.map((group) => group.id)).toEqual([
      "target",
      "request",
      "injection",
      "detection",
      "techniques",
      "enumeration",
      "performance",
      "general",
    ]);
    expect(schema.fields.length).toBeGreaterThanOrEqual(30);
    expect(schema.fields.find((field) => field.id === "database")).toMatchObject({
      flag: "-D",
      resultKind: "database",
    });
  });

  it("maps SSTImap fields to its real CLI groups", () => {
    const schema = getToolSchema("sstimap");

    expect(schema.groups.map((group) => group.id)).toEqual([
      "target",
      "request",
      "crawler",
      "detection",
      "payload",
      "general",
    ]);
    expect(schema.fields.find((field) => field.id === "injectionPoints")).toMatchObject({
      flag: "-P",
    });
    expect(schema.fields.find((field) => field.id === "engine")).toMatchObject({
      flag: "-e",
    });
  });
});
