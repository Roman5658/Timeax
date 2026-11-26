export const themes = ["light", "dark", "mint", "turquoise", "pink"] as const;
export type ThemeName = typeof themes[number];
export const themeStorageKey = "timeax-theme";

export function isThemeName(value: unknown): value is ThemeName {
  return themes.some((option) => option === value);
}

export function readThemePreference(storage: Pick<Storage, "getItem"> | undefined, prefersDark: boolean): ThemeName {
  try {
    const stored = storage?.getItem(themeStorageKey);
    if (isThemeName(stored)) return stored;
  } catch { /* The site can render without browser storage. */ }
  return prefersDark ? "dark" : "light";
}

export function saveThemePreference(storage: Pick<Storage, "setItem"> | undefined, theme: ThemeName) {
  try { storage?.setItem(themeStorageKey, theme); }
  catch { /* Keep the selected appearance for the open page. */ }
}
