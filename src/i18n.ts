import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import translationES from './locales/es.json';
import translationEN from './locales/en.json';

const resources = {
  es: {
    translation: translationES,
  },
  en: {
    translation: translationEN,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'es', // Español como fallback si el idioma del navegador no está disponible
    interpolation: {
      escapeValue: false, // react ya escapa los valores por defecto
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    }
  });

export default i18n;
