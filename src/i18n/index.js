import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import vi from "./locales/vi.json";
const LANGUAGE_STORAGE_KEY = "quant-lang";
function readStoredLanguage() {
    try {
        const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        return raw === "en" || raw === "ru" || raw === "vi" ? raw : null;
    }
    catch {
        return null;
    }
}
const stored = readStoredLanguage();
void i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        ru: { translation: ru },
        vi: { translation: vi },
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
