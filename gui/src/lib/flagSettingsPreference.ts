import {
  DEFAULT_FLAG_PREFIX_PREFERENCE,
  type FlagPrefixPreference,
} from "./flagPrefixPreference";

export interface FlagSettings {
  enabled: boolean;
  prefixes: FlagPrefixPreference;
  scanOutput: boolean;
  scanStructured: boolean;
  scanBase64: boolean;
  caseSensitive: boolean;
  pauseOnMatch: boolean;
}

export const DEFAULT_FLAG_SETTINGS: FlagSettings = {
  enabled: true,
  prefixes: DEFAULT_FLAG_PREFIX_PREFERENCE,
  scanOutput: true,
  scanStructured: true,
  scanBase64: true,
  caseSensitive: false,
  pauseOnMatch: false,
};

export const FLAG_SETTINGS_STORAGE_KEY = "ctfbox.flagSettings";

interface FlagSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredFlagSettings {
  version: 1;
  enabled: boolean;
  scanOutput: boolean;
  scanStructured: boolean;
  scanBase64: boolean;
  caseSensitive: boolean;
  pauseOnMatch: boolean;
}

function defaultStorage(): FlagSettingsStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function withPrefixes(prefixes: FlagPrefixPreference): FlagSettings {
  return { ...DEFAULT_FLAG_SETTINGS, prefixes };
}

export function loadFlagSettingsPreference(
  prefixes: FlagPrefixPreference,
  storage: FlagSettingsStorage | undefined = defaultStorage(),
): FlagSettings {
  if (!storage) return withPrefixes(prefixes);
  try {
    const serialized = storage.getItem(FLAG_SETTINGS_STORAGE_KEY);
    if (!serialized) return withPrefixes(prefixes);
    const stored = JSON.parse(serialized) as Partial<StoredFlagSettings>;
    if (stored.version !== 1) return withPrefixes(prefixes);
    const defaults = withPrefixes(prefixes);
    return {
      prefixes,
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaults.enabled,
      scanOutput: typeof stored.scanOutput === "boolean" ? stored.scanOutput : defaults.scanOutput,
      scanStructured: typeof stored.scanStructured === "boolean" ? stored.scanStructured : defaults.scanStructured,
      scanBase64: typeof stored.scanBase64 === "boolean" ? stored.scanBase64 : defaults.scanBase64,
      caseSensitive: typeof stored.caseSensitive === "boolean" ? stored.caseSensitive : defaults.caseSensitive,
      pauseOnMatch: typeof stored.pauseOnMatch === "boolean" ? stored.pauseOnMatch : defaults.pauseOnMatch,
    };
  } catch {
    return withPrefixes(prefixes);
  }
}

export function saveFlagSettingsPreference(
  settings: FlagSettings,
  storage: FlagSettingsStorage | undefined = defaultStorage(),
) {
  const stored: StoredFlagSettings = {
    version: 1,
    enabled: settings.enabled,
    scanOutput: settings.scanOutput,
    scanStructured: settings.scanStructured,
    scanBase64: settings.scanBase64,
    caseSensitive: settings.caseSensitive,
    pauseOnMatch: settings.pauseOnMatch,
  };
  try {
    storage?.setItem(FLAG_SETTINGS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Keep in-memory settings usable when browser storage is unavailable.
  }
}
