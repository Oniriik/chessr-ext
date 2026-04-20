import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useLayoutStore } from './layoutStore';
import { useEngineStore } from './engineStore';
import { useAutoMoveStore } from './autoMoveStore';

export type ChessTitle = 'GM' | 'IM' | 'FM' | 'NM' | 'CM' | 'WGM' | 'WIM' | 'WFM' | 'WCM' | 'WNM';

interface Settings {
  numArrows: number;
  arrowColors: [string, string, string];
  disableAnimations: boolean;
  highlightSquares: boolean;
  anonNames: boolean;
  showTitle: boolean;
  titleType: ChessTitle;
  autoOpenOnGameEnd: boolean;
  autoOpenOnReview: boolean;
}

const DEFAULTS: Settings = {
  numArrows: 3,
  arrowColors: ['#22c55e', '#3b82f6', '#f59e0b'],
  disableAnimations: false,
  highlightSquares: false,
  anonNames: false,
  showTitle: false,
  titleType: 'GM',
  autoOpenOnGameEnd: false,
  autoOpenOnReview: true,
};

export interface SettingsState extends Settings {
  setNumArrows: (n: number) => void;
  setArrowColor: (index: number, color: string) => void;
  setDisableAnimations: (v: boolean) => void;
  setHighlightSquares: (v: boolean) => void;
  setAnonNames: (v: boolean) => void;
  setShowTitle: (v: boolean) => void;
  setTitleType: (t: ChessTitle) => void;
  setAutoOpenOnGameEnd: (v: boolean) => void;
  setAutoOpenOnReview: (v: boolean) => void;
  resetAll: () => void;
  loadFromCloud: (userId: string) => Promise<void>;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;

function getEnginePayload() {
  const e = useEngineStore.getState();
  return {
    targetEloAuto: e.targetEloAuto,
    targetEloManual: e.targetEloManual,
    autoEloBoost: e.autoEloBoost,
    personality: e.personality,
    ambitionAuto: e.ambitionAuto,
    ambition: e.ambition,
    variety: e.variety,
    limitStrength: e.limitStrength,
    searchMode: e.searchMode,
    searchNodes: e.searchNodes,
    searchDepth: e.searchDepth,
    searchMovetime: e.searchMovetime,
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
    autoPlayDelay: a.autoPlayDelay,
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
    numArrows: state.numArrows,
    arrowColors: state.arrowColors,
    disableAnimations: state.disableAnimations,
    highlightSquares: state.highlightSquares,
    anonNames: state.anonNames,
    showTitle: state.showTitle,
    titleType: state.titleType,
    autoOpenOnGameEnd: state.autoOpenOnGameEnd,
    autoOpenOnReview: state.autoOpenOnReview,
    layout: useLayoutStore.getState().getConfig(),
    engine: getEnginePayload(),
    autoMove: getAutoMovePayload(),
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
  setDisableAnimations: (v) => {
    set({ disableAnimations: v });
    syncToCloud(get());
  },
  setHighlightSquares: (v) => {
    set({ highlightSquares: v });
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

  resetAll: () => {
    set({ ...DEFAULTS });
    useEngineStore.getState().resetToDefaults();
    useAutoMoveStore.getState().resetToDefaults();
    useLayoutStore.getState().resetToDefaults();
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
        set({
          numArrows: cloud.numArrows ?? DEFAULTS.numArrows,
          arrowColors: cloud.arrowColors ?? DEFAULTS.arrowColors,
          disableAnimations: cloud.disableAnimations ?? DEFAULTS.disableAnimations,
          highlightSquares: cloud.highlightSquares ?? DEFAULTS.highlightSquares,
          anonNames: (cloud as any).anonNames ?? DEFAULTS.anonNames,
          showTitle: nextShowTitle,
          titleType: nextTitleType,
          autoOpenOnGameEnd: (cloud as any).autoOpenOnGameEnd ?? DEFAULTS.autoOpenOnGameEnd,
          autoOpenOnReview: (cloud as any).autoOpenOnReview ?? DEFAULTS.autoOpenOnReview,
        });
        // Sync anon state to pageContext after cloud load
        window.postMessage({ type: 'chessr:setAnon', value: (cloud as any).anonNames ?? false }, '*');
        window.postMessage({ type: 'chessr:setTitle', enabled: nextShowTitle, type_: nextTitleType }, '*');
        if (cloud.layout) {
          useLayoutStore.getState().loadFromCloud(cloud.layout);
        }
        if ((cloud as any).engine) {
          const eng = (cloud as any).engine;
          const es = useEngineStore.getState();
          if (eng.targetEloAuto !== undefined) es.setTargetEloAuto(eng.targetEloAuto);
          if (eng.targetEloManual !== undefined) es.setTargetEloManual(eng.targetEloManual);
          if (eng.autoEloBoost !== undefined) es.setAutoEloBoost(eng.autoEloBoost);
          if (eng.personality !== undefined) es.setPersonality(eng.personality);
          if (eng.ambitionAuto !== undefined) es.setAmbitionAuto(eng.ambitionAuto);
          if (eng.ambition !== undefined) es.setAmbition(eng.ambition);
          if (eng.variety !== undefined) es.setVariety(eng.variety);
          if (eng.limitStrength !== undefined) es.setLimitStrength(eng.limitStrength);
          if (eng.searchMode !== undefined) es.setSearchMode(eng.searchMode);
          if (eng.searchNodes !== undefined) es.setSearchNodes(eng.searchNodes);
          if (eng.searchDepth !== undefined) es.setSearchDepth(eng.searchDepth);
          if (eng.searchMovetime !== undefined) es.setSearchMovetime(eng.searchMovetime);
        }
        if ((cloud as any).autoMove) {
          // Hydrate autoMove store directly — bypass setters to avoid triggering re-sync
          useAutoMoveStore.setState((cloud as any).autoMove);
        }
      }
    } catch {}
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
