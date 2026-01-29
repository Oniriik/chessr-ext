import { useAppStore } from '../presentation/store/app.store';
import { fr } from './translations/fr';
import { en } from './translations/en';
import { es } from './translations/es';
import { ru } from './translations/ru';
import { de } from './translations/de';
import { pt } from './translations/pt';
import { hi } from './translations/hi';
import type { Language, Translations } from './types';

const translations: Record<Language, Translations> = {
  en,
  fr,
  es,
  ru,
  de,
  pt,
  hi,
};

/**
 * Detect browser language
 * Returns detected language if supported, otherwise 'en'
 */
export function detectBrowserLanguage(): Language {
  const lang = (navigator.language || (navigator as any).userLanguage || 'en').toLowerCase();

  if (lang.startsWith('fr')) return 'fr';
  if (lang.startsWith('es')) return 'es';
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('de')) return 'de';
  if (lang.startsWith('pt')) return 'pt';
  if (lang.startsWith('hi')) return 'hi';

  return 'en';
}

/**
 * Hook to access translations
 * Automatically detects language based on user settings or browser
 */
export function useTranslation() {
  const { settings } = useAppStore();

  const currentLanguage: Language = settings.language === 'auto'
    ? detectBrowserLanguage()
    : settings.language as Language;

  const t = translations[currentLanguage] || en;

  return { t, currentLanguage };
}

// Export types
export type { Translations, Language } from './types';
