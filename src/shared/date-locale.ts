export function dateLocale(language: string): string {
  if (language === "uk") return "uk-UA";
  if (language === "ru") return "ru-RU";
  if (language === "en") return "en-GB";
  return "pl-PL";
}
