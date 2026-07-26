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

  it("falls back cleanly when browser storage is unavailable", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(loadTheme(storage)).toBe("dark");
    expect(() => saveTheme("light", storage)).not.toThrow();
  });

  it("handles an inaccessible global localStorage property", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => { throw new Error("blocked"); },
    });

    try {
      expect(loadTheme()).toBe("dark");
      expect(() => saveTheme("light")).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
