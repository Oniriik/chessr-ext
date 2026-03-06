import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';

// EN
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enSettings from './locales/en/settings.json';
import enGame from './locales/en/game.json';
import enEngine from './locales/en/engine.json';
import enPuzzles from './locales/en/puzzles.json';
import enBanners from './locales/en/banners.json';

// FR
import frCommon from './locales/fr/common.json';
import frAuth from './locales/fr/auth.json';
import frSettings from './locales/fr/settings.json';
import frGame from './locales/fr/game.json';
import frEngine from './locales/fr/engine.json';
import frPuzzles from './locales/fr/puzzles.json';
import frBanners from './locales/fr/banners.json';

// ES
import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esSettings from './locales/es/settings.json';
import esGame from './locales/es/game.json';
import esEngine from './locales/es/engine.json';
import esPuzzles from './locales/es/puzzles.json';
import esBanners from './locales/es/banners.json';

// PT-BR
import ptBRCommon from './locales/pt-BR/common.json';
import ptBRAuth from './locales/pt-BR/auth.json';
import ptBRSettings from './locales/pt-BR/settings.json';
import ptBRGame from './locales/pt-BR/game.json';
import ptBREngine from './locales/pt-BR/engine.json';
import ptBRPuzzles from './locales/pt-BR/puzzles.json';
import ptBRBanners from './locales/pt-BR/banners.json';

// DE
import deCommon from './locales/de/common.json';
import deAuth from './locales/de/auth.json';
import deSettings from './locales/de/settings.json';
import deGame from './locales/de/game.json';
import deEngine from './locales/de/engine.json';
import dePuzzles from './locales/de/puzzles.json';
import deBanners from './locales/de/banners.json';

// AR
import arCommon from './locales/ar/common.json';
import arAuth from './locales/ar/auth.json';
import arSettings from './locales/ar/settings.json';
import arGame from './locales/ar/game.json';
import arEngine from './locales/ar/engine.json';
import arPuzzles from './locales/ar/puzzles.json';
import arBanners from './locales/ar/banners.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية', rtl: true },
] as const;

export const RTL_LANGUAGES = ['ar'];

const ns = ['common', 'auth', 'settings', 'game', 'engine', 'puzzles', 'banners'] as const;

i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, auth: enAuth, settings: enSettings, game: enGame, engine: enEngine, puzzles: enPuzzles, banners: enBanners },
    fr: { common: frCommon, auth: frAuth, settings: frSettings, game: frGame, engine: frEngine, puzzles: frPuzzles, banners: frBanners },
    es: { common: esCommon, auth: esAuth, settings: esSettings, game: esGame, engine: esEngine, puzzles: esPuzzles, banners: esBanners },
    'pt-BR': { common: ptBRCommon, auth: ptBRAuth, settings: ptBRSettings, game: ptBRGame, engine: ptBREngine, puzzles: ptBRPuzzles, banners: ptBRBanners },
    de: { common: deCommon, auth: deAuth, settings: deSettings, game: deGame, engine: deEngine, puzzles: dePuzzles, banners: deBanners },
    ar: { common: arCommon, auth: arAuth, settings: arSettings, game: arGame, engine: arEngine, puzzles: arPuzzles, banners: arBanners },
  },
  lng: 'en',
  fallbackLng: 'en',
  ns,
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
});

// Sync with Zustand settings store
function syncLanguage() {
  const lang = useSettingsStore.getState().language || 'en';
  if (i18n.language !== lang) {
    i18n.changeLanguage(lang);
  }
}

// Initial sync (store may have loaded from chrome.storage)
// Use a small delay to wait for Zustand hydration
setTimeout(syncLanguage, 100);

// Subscribe to future changes
useSettingsStore.subscribe((state, prevState) => {
  if (state.language !== prevState.language) {
    i18n.changeLanguage(state.language);
  }
});

// Update dir attribute on language change for RTL support
i18n.on('languageChanged', (lng) => {
  const isRtl = RTL_LANGUAGES.includes(lng);
  document.querySelectorAll('.chessr-mount').forEach((el) => {
    (el as HTMLElement).setAttribute('dir', isRtl ? 'rtl' : 'ltr');
  });
});

export default i18n;
