import { describe, expect, it } from "vitest";
import { loadTheme, saveTheme } from "./themePreference";

function createStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  };
}

describe("theme preference", () => {
  it("loads a persisted light theme and falls back to dark for unknown values", () => {
    expect(loadTheme(createStorage("light"))).toBe("light");
    expect(loadTheme(createStorage("system"))).toBe("dark");
  });

  it("persists the selected theme", () => {
    const storage = createStorage();
    saveTheme("light", storage);
    expect(loadTheme(storage)).toBe("light");
  });
});
