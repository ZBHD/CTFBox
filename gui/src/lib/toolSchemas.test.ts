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

  it("covers the dirsearch directory brute-force workflow", () => {
    const schema = getToolSchema("dirsearch");
    expect(schema.groups.map((group) => group.id)).toEqual([
      "target",
      "wordlist",
      "filter",
      "request",
      "crawl",
      "performance",
    ]);
    expect(schema.fields.find((field) => field.id === "url")).toMatchObject({ flag: "-u" });
    expect(schema.fields.find((field) => field.id === "headers")).toMatchObject({ flag: "-H", repeatable: true });
  });

  it("covers subfinder enumeration with JSON output", () => {
    const schema = getToolSchema("subfinder");
    expect(schema.fields.find((field) => field.id === "domain")).toMatchObject({ flag: "-d" });
    expect(schema.fields.find((field) => field.id === "json")).toMatchObject({ flag: "-oJ", control: "boolean" });
  });

  it("covers nuclei templates and structured output", () => {
    const schema = getToolSchema("nuclei");
    expect(schema.fields.find((field) => field.id === "severity")).toMatchObject({ flag: "-severity" });
    expect(schema.fields.find((field) => field.id === "jsonl")).toMatchObject({ flag: "-jsonl", control: "boolean" });
  });
});
