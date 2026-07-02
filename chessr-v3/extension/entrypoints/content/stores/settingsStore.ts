import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useLayoutStore } from './layoutStore';
import { useEngineStore } from './engineStore';
import { useAutoMoveStore } from './autoMoveStore';
import { useAuthStore } from './authStore';
import { useOpeningStore } from './openingStore';
import {
  setLocalePreference,
  SUPPORTED_LOCALES,
  type LocalePreference,
  type LocaleCode,
} from '../lib/i18n';

export type ChessTitle = 'GM' | 'IM' | 'FM' | 'NM' | 'CM' | 'WGM' | 'WIM' | 'WFM' | 'WCM' | 'WNM';
export type FontSize = 'small' | 'normal' | 'big';

interface Settings {
  showSuggestedMoves: boolean;
  numArrows: number;
  arrowColors: [string, string, string];
  showOpponentArrow: boolean;
  opponentArrowColor: string;
  disableAnimations: boolean;
  /** When true, suppress proactive nudges from the system-message
   *  widget (how-tos, "join Discord", "claim free trial"). Admin
   *  broadcasts via WS still come through — they're explicit ops
   *  messages, not nudges, and bypass this gate. */
  disableInfoBanner: boolean;
  highlightSquares: boolean;
  showMyLastMove: boolean;
  anonNames: boolean;
  showTitle: boolean;
  titleType: ChessTitle;
  autoOpenOnGameEnd: boolean;
  autoOpenOnReview: boolean;
  fontSize: FontSize;
  /** UI language preference. 'auto' = follow navigator.language (default
   *  for new installs); otherwise an explicit locale code from
   *  SUPPORTED_LOCALES. Cloud-synced via the same user_settings
   *  payload as the rest, so switching to FR on desktop reflects on
   *  the phone-side Chrome instantly. */
  locale: LocalePreference;
}

const DEFAULTS: Settings = {
  showSuggestedMoves: true,
  numArrows: 3,
  arrowColors: ['#22c55e', '#3b82f6', '#f59e0b'],
  showOpponentArrow: true,
  opponentArrowColor: '#cd0e2b',
  disableAnimations: false,
  disableInfoBanner: false,
  highlightSquares: false,
  showMyLastMove: false,
  anonNames: false,
  showTitle: false,
  titleType: 'GM',
  autoOpenOnGameEnd: false,
  autoOpenOnReview: true,
  fontSize: 'normal',
  locale: 'auto',
};

export interface SettingsState extends Settings {
  /** True once loadFromCloud has resolved (success or failure). */
  settingsLoaded: boolean;
  setShowSuggestedMoves: (v: boolean) => void;
  setNumArrows: (n: number) => void;
  setArrowColor: (index: number, color: string) => void;
  setShowOpponentArrow: (v: boolean) => void;
  setOpponentArrowColor: (color: string) => void;
  setDisableAnimations: (v: boolean) => void;
  setDisableInfoBanner: (v: boolean) => void;
  setHighlightSquares: (v: boolean) => void;
  setShowMyLastMove: (v: boolean) => void;
  setAnonNames: (v: boolean) => void;
  setShowTitle: (v: boolean) => void;
  setTitleType: (t: ChessTitle) => void;
  setAutoOpenOnGameEnd: (v: boolean) => void;
  setAutoOpenOnReview: (v: boolean) => void;
  setFontSize: (v: FontSize) => void;
  setLocale: (v: LocalePreference) => void;
  resetAll: () => void;
  loadFromCloud: (userId: string) => Promise<void>;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;

function getEnginePayload() {
  const e = useEngineStore.getState();
  return {
    engineId: e.engineId,
    maiaVariant: e.maiaVariant,
    maiaTargetEloAuto: e.maiaTargetEloAuto,
    maiaTargetEloManual: e.maiaTargetEloManual,
    maiaOppoEloAuto: e.maiaOppoEloAuto,
    maiaOppoEloManual: e.maiaOppoEloManual,
    maiaUseBook: e.maiaUseBook,
    targetEloAuto: e.targetEloAuto,
    targetEloManual: e.targetEloManual,
    autoEloBoost: e.autoEloBoost,
    personality: e.personality,
    dynamismAuto: e.dynamismAuto,
    dynamism: e.dynamism,
    kingSafetyAuto: e.kingSafetyAuto,
    kingSafety: e.kingSafety,
    variety: e.variety,
    limitStrength: e.limitStrength,
    searchMode: e.searchMode,
    searchNodes: e.searchNodes,
    searchDepth: e.searchDepth,
    searchMovetime: e.searchMovetime,
    rodentPersonality: e.rodentPersonality,
    imprecision: e.imprecision,
  };
}

function getAutoMovePayload() {
  const a = useAutoMoveStore.getState();
  return {
    mode: a.mode,
    hotkey1: a.hotkey1,
    hotkey2: a.hotkey2,
    hotkey3: a.hotkey3,
    premoveKey: a.premoveKey,
    premoveDelay: a.premoveDelay,
    useOnScreenButtons: a.useOnScreenButtons,
    autoPlayDelay: a.autoPlayDelay,
    autoPlayPauseKey: a.autoPlayPauseKey,
    autoPremove: a.autoPremove,
    autoRematch: a.autoRematch,
    movePreset: a.movePreset,
    moveWeights: a.moveWeights,
    moveWeightsCustom: a.moveWeightsCustom,
    humanize: a.humanize,
  };
}

function getSettingsPayload(state: SettingsState) {
  return {
    showSuggestedMoves: state.showSuggestedMoves,
    numArrows: state.numArrows,
    arrowColors: state.arrowColors,
    showOpponentArrow: state.showOpponentArrow,
    opponentArrowColor: state.opponentArrowColor,
    disableAnimations: state.disableAnimations,
    disableInfoBanner: state.disableInfoBanner,
    highlightSquares: state.highlightSquares,
    showMyLastMove: state.showMyLastMove,
    anonNames: state.anonNames,
    showTitle: state.showTitle,
    titleType: state.titleType,
    autoOpenOnGameEnd: state.autoOpenOnGameEnd,
    autoOpenOnReview: state.autoOpenOnReview,
    fontSize: state.fontSize,
    locale: state.locale,
    layout: useLayoutStore.getState().getConfig(),
    engine: getEnginePayload(),
    autoMove: getAutoMovePayload(),
    opening: useOpeningStore.getState().getPayload(),
  };
}

function syncToCloud(state: SettingsState) {
  if (!currentUserId) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const payload = getSettingsPayload(state);
    supabase
      .from('user_settings')
      .update({ extension_settings: payload })
      .eq('user_id', currentUserId)
      .then();
  }, 1000);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  settingsLoaded: false,

  setShowSuggestedMoves: (v) => {
    set({ showSuggestedMoves: v });
    syncToCloud(get());
  },
  setNumArrows: (n) => {
    set({ numArrows: Math.max(1, Math.min(3, n)) });
    syncToCloud(get());
  },
  setArrowColor: (index, color) => {
    const colors = [...get().arrowColors] as [string, string, string];
    colors[index] = color;
    set({ arrowColors: colors });
    syncToCloud(get());
  },
  setShowOpponentArrow: (v) => {
    set({ showOpponentArrow: v });
    syncToCloud(get());
  },
  setOpponentArrowColor: (color) => {
    set({ opponentArrowColor: color });
    syncToCloud(get());
  },
  setDisableAnimations: (v) => {
    set({ disableAnimations: v });
    syncToCloud(get());
  },
  setDisableInfoBanner: (v) => {
    set({ disableInfoBanner: v });
    syncToCloud(get());
  },
  setHighlightSquares: (v) => {
    set({ highlightSquares: v });
    syncToCloud(get());
  },
  setShowMyLastMove: (v) => {
    set({ showMyLastMove: v });
    syncToCloud(get());
  },
  setAnonNames: (v) => {
    set({ anonNames: v });
    syncToCloud(get());
    // Notify pageContext (MAIN world) to toggle blur
    window.postMessage({ type: 'chessr:setAnon', value: v }, '*');
  },
  setShowTitle: (v) => {
    set({ showTitle: v });
    syncToCloud(get());
    window.postMessage({ type: 'chessr:setTitle', enabled: v, type_: get().titleType }, '*');
  },
  setTitleType: (t) => {
    set({ titleType: t });
    syncToCloud(get());
    window.postMessage({ type: 'chessr:setTitle', enabled: get().showTitle, type_: t }, '*');
  },
  setAutoOpenOnGameEnd: (v) => {
    set({ autoOpenOnGameEnd: v });
    syncToCloud(get());
  },
  setAutoOpenOnReview: (v) => {
    set({ autoOpenOnReview: v });
    syncToCloud(get());
  },
  setFontSize: (v) => {
    set({ fontSize: v });
    syncToCloud(get());
  },
  setLocale: (v) => {
    set({ locale: v });
    setLocalePreference(v);
    syncToCloud(get());
  },

  resetAll: () => {
    set({ ...DEFAULTS });
    useEngineStore.getState().resetToDefaults();
    useAutoMoveStore.getState().resetToDefaults();
    useLayoutStore.getState().resetToDefaults();
    setLocalePreference(DEFAULTS.locale);
    syncToCloud(get());
    window.postMessage({ type: 'chessr:setAnon', value: DEFAULTS.anonNames }, '*');
    window.postMessage({ type: 'chessr:setTitle', enabled: DEFAULTS.showTitle, type_: DEFAULTS.titleType }, '*');
  },

  loadFromCloud: async (userId: string) => {
    currentUserId = userId;
    try {
      const { data } = await supabase
        .from('user_settings')
        .select('extension_settings')
        .eq('user_id', userId)
        .single();

      if (data?.extension_settings) {
        const cloud = data.extension_settings as Partial<Settings>;
        const nextShowTitle = (cloud as any).showTitle ?? DEFAULTS.showTitle;
        const nextTitleType = ((cloud as any).titleType as ChessTitle) ?? DEFAULTS.titleType;
        // Validate cloud locale against the supported set — anything
        // else (a removed code, a typo, a future addition that this
        // build doesn't know about) falls back to 'auto'.
        const rawLocale = (cloud as any).locale as LocalePreference | undefined;
        const nextLocale: LocalePreference =
          rawLocale === 'auto' || (SUPPORTED_LOCALES as string[]).includes(rawLocale as string)
            ? rawLocale!
            : DEFAULTS.locale;
        set({
          showSuggestedMoves: (cloud as any).showSuggestedMoves ?? DEFAULTS.showSuggestedMoves,
          numArrows: cloud.numArrows ?? DEFAULTS.numArrows,
          arrowColors: cloud.arrowColors ?? DEFAULTS.arrowColors,
          showOpponentArrow: (cloud as any).showOpponentArrow ?? DEFAULTS.showOpponentArrow,
          opponentArrowColor: (cloud as any).opponentArrowColor ?? DEFAULTS.opponentArrowColor,
          disableAnimations: cloud.disableAnimations ?? DEFAULTS.disableAnimations,
          disableInfoBanner: cloud.disableInfoBanner ?? DEFAULTS.disableInfoBanner,
          highlightSquares: cloud.highlightSquares ?? DEFAULTS.highlightSquares,
          showMyLastMove: (cloud as any).showMyLastMove ?? DEFAULTS.showMyLastMove,
          anonNames: (cloud as any).anonNames ?? DEFAULTS.anonNames,
          showTitle: nextShowTitle,
          titleType: nextTitleType,
          autoOpenOnGameEnd: (cloud as any).autoOpenOnGameEnd ?? DEFAULTS.autoOpenOnGameEnd,
          autoOpenOnReview: (cloud as any).autoOpenOnReview ?? DEFAULTS.autoOpenOnReview,
          fontSize: ((cloud as any).fontSize as FontSize) ?? DEFAULTS.fontSize,
          locale: nextLocale,
        });
        // Push to the i18n module so the UI repaints in the cloud-saved
        // language even before the user touches the picker.
        setLocalePreference(nextLocale);
        // Sync anon state to pageContext after cloud load
        window.postMessage({ type: 'chessr:setAnon', value: (cloud as any).anonNames ?? false }, '*');
        window.postMessage({ type: 'chessr:setTitle', enabled: nextShowTitle, type_: nextTitleType }, '*');
        if ((cloud as any).layout) {
          useLayoutStore.getState().loadFromCloud((cloud as any).layout);
        }
        if ((cloud as any).engine) {
          const eng = (cloud as any).engine;
          const es = useEngineStore.getState();
          // Sanitize engineId — old cloud rows can have removed IDs like
          // 'patricia' (dropped in 3.1.0) or 'torch' (dropped when torch
          // became classification-only). Unknown IDs fall through and the
          // store keeps its default ('komodo'). Also downgrade Maia 2 /
          // Maia 3 to Komodo on free users (premium-only engines).
          const knownIds = ['komodo', 'maia3', 'rodent', 'stockfish'];
          if (knownIds.includes(eng.engineId)) {
            const plan = useAuthStore.getState().plan;
            const premiumPlan = plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';
            const FREE_OK = ['komodo', 'stockfish'];
            const finalId = premiumPlan || FREE_OK.includes(eng.engineId)
              ? eng.engineId
              : 'komodo';
            es.setEngineId(finalId);
          }
          if (eng.maiaVariant !== undefined) es.setMaiaVariant(eng.maiaVariant);
          if (eng.maiaTargetEloAuto !== undefined) es.setMaiaTargetEloAuto(eng.maiaTargetEloAuto);
          if (eng.maiaTargetEloManual !== undefined) es.setMaiaTargetEloManual(eng.maiaTargetEloManual);
          if (eng.maiaOppoEloAuto !== undefined) es.setMaiaOppoEloAuto(eng.maiaOppoEloAuto);
          if (eng.maiaOppoEloManual !== undefined) es.setMaiaOppoEloManual(eng.maiaOppoEloManual);
          if (eng.maiaUseBook !== undefined) es.setMaiaUseBook(eng.maiaUseBook);
          if (eng.targetEloAuto !== undefined) es.setTargetEloAuto(eng.targetEloAuto);
          if (eng.targetEloManual !== undefined) es.setTargetEloManual(eng.targetEloManual);
          if (eng.autoEloBoost !== undefined) es.setAutoEloBoost(eng.autoEloBoost);
          if (eng.personality !== undefined) es.setPersonality(eng.personality);
          if (eng.dynamismAuto !== undefined) es.setDynamismAuto(eng.dynamismAuto);
          if (eng.dynamism !== undefined) es.setDynamism(eng.dynamism);
          if (eng.kingSafetyAuto !== undefined) es.setKingSafetyAuto(eng.kingSafetyAuto);
          if (eng.kingSafety !== undefined) es.setKingSafety(eng.kingSafety);
          if (eng.variety !== undefined) es.setVariety(eng.variety);
          if (eng.limitStrength !== undefined) es.setLimitStrength(eng.limitStrength);
          if (eng.searchMode !== undefined) es.setSearchMode(eng.searchMode);
          if (eng.searchNodes !== undefined) es.setSearchNodes(eng.searchNodes);
          if (eng.searchDepth !== undefined) es.setSearchDepth(eng.searchDepth);
          if (eng.searchMovetime !== undefined) es.setSearchMovetime(eng.searchMovetime);
          if (eng.rodentPersonality !== undefined) es.setRodentPersonality(eng.rodentPersonality);
          if (eng.imprecision !== undefined) es.setImprecision(eng.imprecision);
        }
        if ((cloud as any).autoMove) {
          // Hydrate autoMove store directly — bypass setters to avoid triggering re-sync
          useAutoMoveStore.setState((cloud as any).autoMove);
        }
        if ((cloud as any).opening) {
          useOpeningStore.getState().loadFromCloud((cloud as any).opening);
        }
      }
    } catch {
    } finally {
      set({ settingsLoaded: true });
    }
  },
}));

// Sync layout + engine changes to cloud (shared debounce)
let externalSyncTimer: ReturnType<typeof setTimeout> | null = null;
function syncExternalStores() {
  if (!currentUserId) return;
  if (externalSyncTimer) clearTimeout(externalSyncTimer);
  externalSyncTimer = setTimeout(() => {
    const payload = getSettingsPayload(useSettingsStore.getState());
    supabase
      .from('user_settings')
      .update({ extension_settings: payload })
      .eq('user_id', currentUserId)
      .then();
  }, 1000);
}

useLayoutStore.subscribe(syncExternalStores);
useEngineStore.subscribe(syncExternalStores);
useAutoMoveStore.subscribe(syncExternalStores);
useOpeningStore.subscribe(syncExternalStores);
