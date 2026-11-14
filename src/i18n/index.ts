import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import pl from "./locales/pl.json";
import uk from "./locales/uk.json";
import ru from "./locales/ru.json";
import en from "./locales/en.json";

export const languageCodes = ["pl", "uk", "ru", "en"] as const;
export type LanguageCode = (typeof languageCodes)[number];

function normalizeLanguage(value?: string | null): LanguageCode | undefined {
  const candidate = value?.toLowerCase().split("-")[0];
  return languageCodes.find((language) => language === candidate);
}

function getInitialLanguage(): LanguageCode {
  const saved = typeof window === "undefined" ? undefined : window.localStorage.getItem("timeax-language");
  return normalizeLanguage(saved)
    ?? normalizeLanguage(typeof navigator === "undefined" ? undefined : navigator.language)
    ?? normalizeLanguage(typeof navigator === "undefined" ? undefined : navigator.languages?.[0])
    ?? "pl";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      pl: { translation: pl },
      uk: { translation: uk },
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: "en",
    supportedLngs: [...languageCodes],
    interpolation: { escapeValue: false },
    returnNull: false,
  });

i18n.on("languageChanged", (language) => {
  const normalized = normalizeLanguage(language) ?? "pl";
  if (typeof window !== "undefined") window.localStorage.setItem("timeax-language", normalized);
  if (typeof document !== "undefined") document.documentElement.lang = normalized;
});

if (typeof document !== "undefined") document.documentElement.lang = getInitialLanguage();

export default i18n;
