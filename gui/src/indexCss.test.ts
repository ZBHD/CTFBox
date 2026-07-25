// @ts-expect-error Vitest runs in Node; the renderer intentionally omits Node typings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

describe("LSB workbench styles", () => {
  it("keeps analysis options visible when selected in the light theme", () => {
    const inactiveRule = ':root[data-theme="light"] .analysis-option {';
    const activeRule = ':root[data-theme="light"] .analysis-option.active {';
    expect(css).toContain(activeRule);
    expect(css.indexOf(activeRule)).toBeGreaterThan(css.indexOf(inactiveRule));
  });

  it("defines stable token, selected candidate and result tab states", () => {
    expect(css).toContain(".lsb-token {");
    expect(css).toContain(".lsb-candidate-selected {");
    expect(css).toContain(".lsb-result-tabs button.active {");
    expect(css).toContain(':root[data-theme="light"] .lsb-candidate-selected {');
  });

  it("stacks the LSB workspace at narrow widths", () => {
    expect(css).toContain("@media (max-width: 820px)");
    expect(css).toMatch(/\.lsb-workspace-grid\s*\{[^}]*grid-template:/s);
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*html, body, #root\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*\.app-shell\s*\{[^}]*grid-template-columns:/s);
    expect(css).toContain(".lsb-source-panel { overflow: visible; }");
    expect(css).not.toContain(".lsb-source-panel, .lsb-parameter-panel { overflow: visible; }");
  });
});
