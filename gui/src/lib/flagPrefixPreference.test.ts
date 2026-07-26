import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FLAG_PREFIXES,
  DEFAULT_FLAG_PREFIX_PREFERENCE,
  FLAG_PREFIX_PREFERENCE_STORAGE_KEY,
  FLAG_PREFIX_STORAGE_KEY,
  loadFlagPrefixPreference,
  saveFlagPrefixPreference,
} from "./flagPrefixPreference";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    value: (key: string) => values.get(key),
  };
}

describe("flag prefix preference", () => {
  it("ships 45 enabled built-in prefixes", () => {
    expect(BUILT_IN_FLAG_PREFIXES).toHaveLength(45);
    expect(BUILT_IN_FLAG_PREFIXES).toEqual(expect.arrayContaining([
      "flag",
      "CTF",
      "NSSCTF",
      "ctfshow",
      "cyberpeace",
      "DASCTF",
      "CISCN",
      "qwb",
      "0CTF",
      "aliyunctf",
    ]));
    expect(DEFAULT_FLAG_PREFIX_PREFERENCE).toEqual({
      enabled: [...BUILT_IN_FLAG_PREFIXES],
      custom: [],
    });
  });

  it("enables every built-in for new installs and the legacy default", () => {
    expect(loadFlagPrefixPreference(createStorage())).toEqual(DEFAULT_FLAG_PREFIX_PREFERENCE);
    expect(loadFlagPrefixPreference(createStorage({
      [FLAG_PREFIX_STORAGE_KEY]: "flag, CTF",
    }))).toEqual(DEFAULT_FLAG_PREFIX_PREFERENCE);
  });

  it("migrates a customized legacy value and identifies custom prefixes", () => {
    expect(loadFlagPrefixPreference(createStorage({
      [FLAG_PREFIX_STORAGE_KEY]: "flag, DASCTF, TEAM",
    }))).toEqual({
      enabled: ["flag", "DASCTF", "TEAM"],
      custom: ["TEAM"],
    });
  });

  it("preserves an intentionally empty or reduced legacy selection", () => {
    expect(loadFlagPrefixPreference(createStorage({
      [FLAG_PREFIX_STORAGE_KEY]: "",
    }))).toEqual({ enabled: [], custom: [] });
    expect(loadFlagPrefixPreference(createStorage({
      [FLAG_PREFIX_STORAGE_KEY]: "flag",
    }))).toEqual({ enabled: ["flag"], custom: [] });
  });

  it("persists disabled built-ins and custom prefixes in the structured format", () => {
    const storage = createStorage();
    const preference = {
      enabled: ["flag", "TEAM"],
      custom: ["TEAM", "OFFLINE"],
    };

    saveFlagPrefixPreference(preference, storage);

    expect(loadFlagPrefixPreference(storage)).toEqual(preference);
    expect(storage.value(FLAG_PREFIX_STORAGE_KEY)).toBe("flag, TEAM");
    expect(JSON.parse(storage.value(FLAG_PREFIX_PREFERENCE_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      ...preference,
    });
  });

  it("normalizes duplicate and malformed stored values", () => {
    const storage = createStorage({
      [FLAG_PREFIX_PREFERENCE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        enabled: [" flag ", "flag", "", 7, "TEAM"],
        custom: [" TEAM ", "TEAM", "DASCTF", null],
      }),
    });

    expect(loadFlagPrefixPreference(storage)).toEqual({
      enabled: ["flag", "TEAM"],
      custom: ["TEAM"],
    });
  });

  it("falls back to the legacy value when structured JSON is corrupt", () => {
    expect(loadFlagPrefixPreference(createStorage({
      [FLAG_PREFIX_PREFERENCE_STORAGE_KEY]: "not-json",
      [FLAG_PREFIX_STORAGE_KEY]: "flag, OLD",
    }))).toEqual({ enabled: ["flag", "OLD"], custom: ["OLD"] });
  });

  it("falls back or returns cleanly when storage throws", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadFlagPrefixPreference(storage)).toEqual(DEFAULT_FLAG_PREFIX_PREFERENCE);
    expect(() => saveFlagPrefixPreference(DEFAULT_FLAG_PREFIX_PREFERENCE, storage)).not.toThrow();
  });

  it("handles an inaccessible global localStorage property", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => { throw new Error("blocked"); },
    });

    try {
      expect(loadFlagPrefixPreference()).toEqual(DEFAULT_FLAG_PREFIX_PREFERENCE);
      expect(() => saveFlagPrefixPreference(DEFAULT_FLAG_PREFIX_PREFERENCE)).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
