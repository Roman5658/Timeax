import { ChevronDown, Droplets, Leaf, Moon, Sparkles, Sun, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../app/ThemeContext";
import { isThemeName, themes } from "../app/theme-preference";

function PinkThemeIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      className={className} aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.1 10.6C2.6 9.6 1.7 6.9 2.8 4.9c1.3-2.3 4.6-1.4 6.5 2.3m9.6 3.4c2.5-1 3.4-3.7 2.3-5.7-1.3-2.3-4.6-1.4-6.5 2.3" />
      <path d="M19.5 14a7.5 6.9 0 1 1-4.2-6.2" />
      <path d="M18.5 10.8c-1.4-1.4-3.5-2.2-3.5-.1s2 1.8 3.5.1Zm.2 0c1.4-1.4 3.5-2.2 3.5-.1s-2 1.8-3.5.1Z" />
    </svg>
  );
}

const icons = { light: Sun, dark: Moon, mint: Leaf, turquoise: Droplets, pink: PinkThemeIcon, neon: Zap, aurora: Sparkles };

export function ThemeToggle({ expanded = false }: { expanded?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const ThemeIcon = icons[theme];

  return (
    <label className={expanded ? "theme-picker theme-picker--expanded" : "icon-button theme-picker"}
      title={`${t("common.theme")}: ${t(`common.${theme}`)}`}>
      <ThemeIcon size={16} className="theme-picker-icon" aria-hidden="true" />
      <ChevronDown size={10} className="theme-picker-chevron" aria-hidden="true" />
      <select className="theme-picker-select" aria-label={t("common.theme")} value={theme}
        onChange={(event) => {
          const value = event.target.value;
          if (isThemeName(value)) setTheme(value);
        }}>
        {themes.map((option) => <option key={option} value={option}>{t(`common.${option}`)}</option>)}
      </select>
    </label>
  );
}
