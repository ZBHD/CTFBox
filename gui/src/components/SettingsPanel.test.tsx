import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPanel, type FlagSettings } from "./SettingsPanel";

const settings: FlagSettings = {
  enabled: true,
  prefixes: "flag, CTF",
  scanOutput: true,
  scanStructured: true,
  scanBase64: true,
  caseSensitive: false,
  pauseOnMatch: false,
};

describe("SettingsPanel", () => {
  it("exposes an appearance section for the persisted theme", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel value={settings} theme="dark" onChange={() => undefined} onThemeChange={() => undefined} />,
    );

    expect(html).toContain("外观");
    expect(html).toContain("亮色");
  });
});
