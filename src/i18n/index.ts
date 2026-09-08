import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import ru from "./locales/ru.json";

export type SupportedLanguage = "en" | "ru";

const LANGUAGE_STORAGE_KEY = "quant-lang";

function readStoredLanguage(): SupportedLanguage | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw === "en" || raw === "ru" ? raw : null;
  } catch {
    return null;
  }
}

const stored = readStoredLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: stored ?? "ru",
  fallbackLng: "ru",
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export { LANGUAGE_STORAGE_KEY };
export default i18n;
