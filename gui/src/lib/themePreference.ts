export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ctfbox.theme";

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ThemeStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadTheme(storage: ThemeStorage | undefined = defaultStorage()): Theme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme, storage: ThemeStorage | undefined = defaultStorage()) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Keep the selected in-memory theme when browser storage is unavailable.
  }
}
