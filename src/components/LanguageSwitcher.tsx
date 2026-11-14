import { useTranslation } from "react-i18next";
import type { LanguageCode } from "../i18n";

const languageOptions: Array<{ code: LanguageCode; nativeName: string }> = [
  { code: "pl", nativeName: "Polski" },
  { code: "uk", nativeName: "Українська" },
  { code: "ru", nativeName: "Русский" },
  { code: "en", nativeName: "English" },
];

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];

  return (
    <label className={`language-switcher${compact ? " language-switcher--compact" : ""}`}>
      {!compact && <span>{t("common.language")}</span>}
      <select
        aria-label={t("common.language")}
        value={current}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
      >
        {languageOptions.map((option) => (
          <option key={option.code} value={option.code}>{option.nativeName}</option>
        ))}
      </select>
    </label>
  );
}
