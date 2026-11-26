import i18n from "../i18n";
import { dateLocale } from "./date-locale";

function localeTag(): string {
  const language = i18n.resolvedLanguage ?? i18n.language;
  return dateLocale(language);
}

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(localeTag(), options).format(date);
}

export function formatTime(date: Date, hourCycle: "h12" | "h23" = "h23", timeZone = "Europe/Warsaw"): string {
  return new Intl.DateTimeFormat(localeTag(), { hour: "2-digit", minute: "2-digit", hourCycle, timeZone }).format(date);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(), options).format(value);
}
