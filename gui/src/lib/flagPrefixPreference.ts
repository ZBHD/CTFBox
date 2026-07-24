export const DEFAULT_FLAG_PREFIXES = "flag, CTF";
export const FLAG_PREFIX_STORAGE_KEY = "ctfbox.flagPrefixes";

export interface FlagPrefixStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): FlagPrefixStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadFlagPrefixes(storage: FlagPrefixStorage | undefined = defaultStorage()): string {
  try {
    return storage?.getItem(FLAG_PREFIX_STORAGE_KEY) ?? DEFAULT_FLAG_PREFIXES;
  } catch {
    return DEFAULT_FLAG_PREFIXES;
  }
}

export function saveFlagPrefixes(prefixes: string, storage: FlagPrefixStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(FLAG_PREFIX_STORAGE_KEY, prefixes);
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
}
