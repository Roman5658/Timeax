import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../app/ThemeContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const nextLabel = theme === "dark" ? t("common.light") : t("common.dark");

  return (
    <button className="icon-button" type="button" onClick={toggleTheme} aria-label={`${t("common.theme")}: ${nextLabel}`} title={`${t("common.theme")}: ${nextLabel}`}>
      {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
