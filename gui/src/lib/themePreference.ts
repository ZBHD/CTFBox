export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ctfbox.theme";

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadTheme(storage: ThemeStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Theme {
  return storage?.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

export function saveTheme(theme: Theme, storage: ThemeStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  storage?.setItem(THEME_STORAGE_KEY, theme);
}
