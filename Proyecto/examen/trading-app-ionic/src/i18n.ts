import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslation from './locales/en.json';
import esTranslation from './locales/es-LA.json';
import frTranslation from './locales/fr.json';

const resources = {
  en: { translation: enTranslation },
  'es-LA': { translation: esTranslation },
  fr: { translation: frTranslation }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
