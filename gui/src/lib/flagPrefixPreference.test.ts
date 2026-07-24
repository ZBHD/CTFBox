import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAG_PREFIXES,
  FLAG_PREFIX_STORAGE_KEY,
  loadFlagPrefixes,
  saveFlagPrefixes,
} from "./flagPrefixPreference";

function createStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => key === FLAG_PREFIX_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === FLAG_PREFIX_STORAGE_KEY) value = next;
    },
  };
}

describe("flag prefix preference", () => {
  it("loads persisted prefixes and falls back when no value exists", () => {
    expect(loadFlagPrefixes(createStorage("flag, CTF, DASCTF"))).toBe("flag, CTF, DASCTF");
    expect(loadFlagPrefixes(createStorage())).toBe(DEFAULT_FLAG_PREFIXES);
  });

  it("persists and restores an empty prefix value", () => {
    const storage = createStorage();
    saveFlagPrefixes("", storage);
    expect(loadFlagPrefixes(storage)).toBe("");
  });

  it("falls back or returns cleanly when storage throws", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadFlagPrefixes(storage)).toBe(DEFAULT_FLAG_PREFIXES);
    expect(() => saveFlagPrefixes("flag", storage)).not.toThrow();
  });

  it("handles an inaccessible global localStorage property", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => { throw new Error("blocked"); },
    });

    try {
      expect(loadFlagPrefixes()).toBe(DEFAULT_FLAG_PREFIXES);
      expect(() => saveFlagPrefixes("flag")).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
