import { useAppStore } from '../presentation/store/app.store';
import { fr } from './translations/fr';
import { en } from './translations/en';
import type { Language } from './types';

/**
 * Detect browser language
 * Returns 'fr' if browser language starts with 'fr', otherwise 'en'
 */
export function detectBrowserLanguage(): Language {
  const lang = navigator.language || (navigator as any).userLanguage || 'en';
  return lang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
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

  const t = currentLanguage === 'fr' ? fr : en;

  return { t, currentLanguage };
}

// Export types
export type { Translations, Language } from './types';
