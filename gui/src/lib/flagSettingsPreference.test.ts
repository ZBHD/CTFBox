import { describe, expect, it } from "vitest";
import { DEFAULT_FLAG_PREFIX_PREFERENCE } from "./flagPrefixPreference";
import {
  DEFAULT_FLAG_SETTINGS,
  FLAG_SETTINGS_STORAGE_KEY,
  loadFlagSettingsPreference,
  saveFlagSettingsPreference,
} from "./flagSettingsPreference";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    value: (key: string) => values.get(key),
  };
}

describe("global Flag settings preference", () => {
  it("persists every non-prefix detection setting", () => {
    const storage = createStorage();
    const settings = {
      ...DEFAULT_FLAG_SETTINGS,
      prefixes: DEFAULT_FLAG_PREFIX_PREFERENCE,
      enabled: false,
      scanOutput: false,
      scanStructured: false,
      scanBase64: false,
      caseSensitive: true,
      pauseOnMatch: true,
    };

    saveFlagSettingsPreference(settings, storage);

    expect(loadFlagSettingsPreference(DEFAULT_FLAG_PREFIX_PREFERENCE, storage)).toEqual(settings);
    expect(JSON.parse(storage.value(FLAG_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 1,
      enabled: false,
      scanOutput: false,
      scanStructured: false,
      scanBase64: false,
      caseSensitive: true,
      pauseOnMatch: true,
    });
  });

  it("uses defaults for corrupt values and unavailable storage", () => {
    const corrupt = createStorage({ [FLAG_SETTINGS_STORAGE_KEY]: "not-json" });
    expect(loadFlagSettingsPreference(DEFAULT_FLAG_PREFIX_PREFERENCE, corrupt)).toEqual({
      ...DEFAULT_FLAG_SETTINGS,
      prefixes: DEFAULT_FLAG_PREFIX_PREFERENCE,
    });

    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadFlagSettingsPreference(DEFAULT_FLAG_PREFIX_PREFERENCE, blocked)).toEqual({
      ...DEFAULT_FLAG_SETTINGS,
      prefixes: DEFAULT_FLAG_PREFIX_PREFERENCE,
    });
    expect(() => saveFlagSettingsPreference(DEFAULT_FLAG_SETTINGS, blocked)).not.toThrow();
  });
});
