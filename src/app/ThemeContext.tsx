import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { readThemePreference, saveThemePreference, type ThemeName } from "./theme-preference";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): ThemeName {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  try { return readThemePreference(window.localStorage, prefersDark); }
  catch { return readThemePreference(undefined, prefersDark); }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { saveThemePreference(window.localStorage, theme); }
    catch { /* The selection still works if storage access is blocked. */ }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
