/**
 * Tiny in-house i18n — chosen over react-i18next to keep the bundle
 * small (the extension is already 170 MB packed). Behavior:
 *
 *  - Dictionaries live in `../locales/<code>.json`, loaded statically
 *    so the obfuscator can see them.
 *  - `useTranslation()` returns `{ t, locale }`, subscribed to
 *    settingsStore so a locale change rerenders every consumer.
 *  - Missing keys fall through: requested locale → EN → key itself.
 *    Means a half-translated UI degrades to EN, never to blanks.
 *  - String interpolation: `t('greet', { name: 'X' })` replaces
 *    `{{name}}` in the value.
 *
 * Adding a language:
 *   1. Add the JSON file in ../locales/<code>.json.
 *   2. Register it below in DICTIONARIES + SUPPORTED_LOCALES.
 *   3. Add a label to LOCALE_LABELS so it shows in the picker.
 *
 * Adding a string:
 *   1. Pick a stable key (dot.namespaced).
 *   2. Add it to en.json (source of truth).
 *   3. Translate in other locales — anything missing falls back to EN.
 */

import { useSyncExternalStore } from 'react';
import en    from '../locales/en.json';
import es    from '../locales/es.json';
import ptBR  from '../locales/pt-BR.json';
import ru    from '../locales/ru.json';
import fr    from '../locales/fr.json';
import de    from '../locales/de.json';
import it    from '../locales/it.json';
import tr    from '../locales/tr.json';

export type LocaleCode = 'en' | 'es' | 'pt-BR' | 'ru' | 'fr' | 'de' | 'it' | 'tr';

const DICTIONARIES: Record<LocaleCode, Record<string, string>> = {
  'en':    en    as Record<string, string>,
  'es':    es    as Record<string, string>,
  'pt-BR': ptBR  as Record<string, string>,
  'ru':    ru    as Record<string, string>,
  'fr':    fr    as Record<string, string>,
  'de':    de    as Record<string, string>,
  'it':    it    as Record<string, string>,
  'tr':    tr    as Record<string, string>,
};

export const SUPPORTED_LOCALES: LocaleCode[] = ['en', 'es', 'pt-BR', 'ru', 'fr', 'de', 'it', 'tr'];

// Native-name labels — picker is shown TO speakers of each language,
// so it should use that language's own name (Spanish users look for
// "Español", not "Spanish").
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  'en':    'English',
  'es':    'Español',
  'pt-BR': 'Português (BR)',
  'ru':    'Русский',
  'fr':    'Français',
  'de':    'Deutsch',
  'it':    'Italiano',
  'tr':    'Türkçe',
};

// 'auto' resolves to the closest match for navigator.language. Stored
// as a separate "preference" string while the resolved code drives the
// dictionary lookup — that way switching browsers from FR Chrome to EN
// Chrome under 'auto' Just Works without re-saving.
export type LocalePreference = LocaleCode | 'auto';

function detectFromNavigator(): LocaleCode {
  if (typeof navigator === 'undefined') return 'en';
  const nav = navigator.language || 'en';
  // Direct match (pt-BR, en, etc.).
  if ((SUPPORTED_LOCALES as string[]).includes(nav)) return nav as LocaleCode;
  // Base-language match — navigator returns 'pt' or 'pt-PT', we map to 'pt-BR';
  // 'en-US' → 'en'; 'es-MX' → 'es'.
  const base = nav.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  if ((SUPPORTED_LOCALES as string[]).includes(base)) return base as LocaleCode;
  return 'en';
}

export function resolveLocale(pref: LocalePreference): LocaleCode {
  return pref === 'auto' ? detectFromNavigator() : pref;
}

// ─── Subscribable locale state ────────────────────────────────────────
// Kept inside i18n.ts (not settingsStore) so importing the t() helper
// doesn't drag the full zustand store + supabase init into a small
// component's dependency graph. settingsStore.setLocale() pushes into
// here; this module is the source of truth for "what locale is the UI
// currently using?".

let currentPref: LocalePreference = 'auto';
let currentLocale: LocaleCode = detectFromNavigator();
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

export function getLocale(): LocaleCode { return currentLocale; }
export function getLocalePreference(): LocalePreference { return currentPref; }

export function setLocalePreference(pref: LocalePreference): void {
  if (currentPref === pref) return;
  currentPref = pref;
  const next = resolveLocale(pref);
  if (next !== currentLocale) {
    currentLocale = next;
  }
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ─── Lookup + interpolation ───────────────────────────────────────────

function lookup(key: string, locale: LocaleCode): string {
  const dict = DICTIONARIES[locale];
  if (dict && key in dict) return dict[key];
  // Fall through to EN — better than a blank string while a locale is
  // still being translated.
  const enDict = DICTIONARIES.en;
  if (enDict && key in enDict) return enDict[key];
  // Last resort: return the key itself. Makes missing strings visible
  // in dev without crashing the UI.
  return key;
}

function interpolate(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  let out = value;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
  }
  return out;
}

/**
 * React hook — returns a `t(key, params?)` function bound to the
 * current locale, plus the resolved locale code itself (handy for
 * conditional formatting like numerals or RTL down the line).
 */
export function useTranslation(): {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: LocaleCode;
} {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return {
    locale,
    t: (key, params) => interpolate(lookup(key, locale), params),
  };
}

/** Imperative variant for non-React code (stores, helpers, etc.). */
export function t(key: string, params?: Record<string, string | number>): string {
  return interpolate(lookup(key, currentLocale), params);
}
