// @ts-expect-error Vitest runs in Node; the renderer tsconfig intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FlagPrefixList styles", () => {
  it("keeps the large prefix list internally scrollable", () => {
    const stylesheet = readFileSync(new URL("./FlagPrefixList.css", import.meta.url), "utf8");

    expect(stylesheet).toMatch(/\.flag-prefix-items\s*\{[^}]*max-height:\s*300px;[^}]*overflow-y:\s*auto;/s);
  });

  it("covers keyboard focus and the light theme", () => {
    const stylesheet = readFileSync(new URL("./FlagPrefixList.css", import.meta.url), "utf8");

    expect(stylesheet).toMatch(/\.flag-prefix-list-field button:focus-visible/);
    expect(stylesheet).toMatch(/:root\[data-theme="light"\] \.flag-prefix-list-field/);
    expect(stylesheet).toMatch(/:root\[data-theme="light"\] \.flag-prefix-search/);
  });
});
