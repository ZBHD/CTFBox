export const BUILT_IN_FLAG_PREFIXES = [
  "flag",
  "CTF",
  "NSSCTF",
  "ctfshow",
  "cyberpeace",
  "DASCTF",
  "CISCN",
  "qwb",
  "hgame",
  "moectf",
  "ACTF",
  "BJDCTF",
  "HCTF",
  "SCTF",
  "SWPUCTF",
  "NPUCTF",
  "VNCTF",
  "D3CTF",
  "N1CTF",
  "rwctf",
  "lilctf",
  "MRCTF",
  "ZJCTF",
  "GWCTF",
  "HNCTF",
  "NKCTF",
  "catctf",
  "FSCTF",
  "LCTF",
  "WHUCTF",
  "hitctf",
  "SUCTF",
  "xnuca",
  "whctf",
  "xctf",
  "RCTF",
  "TCTF",
  "0CTF",
  "Bugku",
  "ctfhub",
  "bytectf",
  "aliyunctf",
  "WMCTF",
  "gzctf",
  "BUUCTF",
] as const;

export interface FlagPrefixPreference {
  enabled: string[];
  custom: string[];
}

export const DEFAULT_FLAG_PREFIXES = BUILT_IN_FLAG_PREFIXES.join(", ");
export const DEFAULT_FLAG_PREFIX_PREFERENCE: FlagPrefixPreference = {
  enabled: [...BUILT_IN_FLAG_PREFIXES],
  custom: [],
};
export const FLAG_PREFIX_STORAGE_KEY = "ctfbox.flagPrefixes";
export const FLAG_PREFIX_PREFERENCE_STORAGE_KEY = "ctfbox.flagPrefixPreference";

export interface FlagPrefixStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredFlagPrefixPreference {
  version: 1;
  enabled: string[];
  custom: string[];
}

const builtInKeys = new Set(BUILT_IN_FLAG_PREFIXES.map((prefix) => prefix.toLocaleLowerCase()));

function defaultStorage(): FlagPrefixStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function cleanPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<string[]>((prefixes, item) => {
    if (typeof item !== "string") return prefixes;
    const prefix = item.trim();
    if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix);
    return prefixes;
  }, []);
}

function parseLegacyPrefixes(value: string | null): string[] {
  return cleanPrefixes(value?.split(",") ?? []);
}

function isBuiltIn(prefix: string): boolean {
  return builtInKeys.has(prefix.toLocaleLowerCase());
}

function normalizePreference(enabledValue: unknown, customValue: unknown): FlagPrefixPreference {
  const enabled = cleanPrefixes(enabledValue);
  const custom = cleanPrefixes([
    ...cleanPrefixes(customValue),
    ...enabled.filter((prefix) => !isBuiltIn(prefix)),
  ]).filter((prefix) => !isBuiltIn(prefix));
  return { enabled, custom };
}

function defaultPreference(): FlagPrefixPreference {
  return {
    enabled: [...DEFAULT_FLAG_PREFIX_PREFERENCE.enabled],
    custom: [],
  };
}

function loadLegacyPreference(storage: FlagPrefixStorage): FlagPrefixPreference {
  const serialized = storage.getItem(FLAG_PREFIX_STORAGE_KEY);
  if (serialized === null) return defaultPreference();
  const legacy = parseLegacyPrefixes(serialized);
  const legacyDefault = ["flag", "CTF"];
  if (legacy.length === legacyDefault.length && legacy.every((prefix, index) => prefix === legacyDefault[index])) {
    return defaultPreference();
  }
  return normalizePreference(legacy, []);
}

export function loadFlagPrefixPreference(
  storage: FlagPrefixStorage | undefined = defaultStorage(),
): FlagPrefixPreference {
  if (!storage) return defaultPreference();
  try {
    const serialized = storage.getItem(FLAG_PREFIX_PREFERENCE_STORAGE_KEY);
    if (serialized) {
      try {
        const stored = JSON.parse(serialized) as Partial<StoredFlagPrefixPreference>;
        if (stored.version === 1 && Array.isArray(stored.enabled) && Array.isArray(stored.custom)) {
          return normalizePreference(stored.enabled, stored.custom);
        }
      } catch {
        // Fall through to the legacy preference when the structured value is corrupt.
      }
    }
    return loadLegacyPreference(storage);
  } catch {
    return defaultPreference();
  }
}

export function saveFlagPrefixPreference(
  preference: FlagPrefixPreference,
  storage: FlagPrefixStorage | undefined = defaultStorage(),
): void {
  try {
    const normalized = normalizePreference(preference.enabled, preference.custom);
    const stored: StoredFlagPrefixPreference = { version: 1, ...normalized };
    storage?.setItem(FLAG_PREFIX_PREFERENCE_STORAGE_KEY, JSON.stringify(stored));
    storage?.setItem(FLAG_PREFIX_STORAGE_KEY, normalized.enabled.join(", "));
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
}
