import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AutoMoveMode = 'off' | 'hotkey' | 'auto';
export type HumanizeTarget = 'hotkey' | 'auto';
export type MovePreset = 'mostly-best' | 'balanced' | 'equal' | 'manual';
export type HumanizePreset = 'fast' | 'balanced' | 'slow' | 'manual';

export const MOVE_PRESETS: Record<Exclude<MovePreset, 'manual'>, [number, number, number]> = {
  'mostly-best': [80, 15, 5],
  'balanced':    [50, 30, 20],
  'equal':       [34, 33, 33],
};

type HumanizeTriplet = {
  pickDelay:   [number, number];
  selectDelay: [number, number];
  moveDelay:   [number, number];
};

export const HUMANIZE_PRESETS: Record<Exclude<HumanizePreset, 'manual'>, HumanizeTriplet> = {
  fast:     { pickDelay: [20, 60],   selectDelay: [10, 40],   moveDelay: [50, 120]  }, // ~150ms
  balanced: { pickDelay: [50, 150],  selectDelay: [30, 100],  moveDelay: [100, 300] }, // ~365ms
  slow:     { pickDelay: [150, 300], selectDelay: [100, 200], moveDelay: [200, 500] }, // ~725ms
};

export interface HumanizeConfig {
  preset: HumanizePreset;
  pickDelay:   [number, number];
  selectDelay: [number, number];
  moveDelay:   [number, number];
  custom: HumanizeTriplet;
}

const defaultHumanize = (): HumanizeConfig => ({
  preset: 'balanced',
  pickDelay:   HUMANIZE_PRESETS.balanced.pickDelay,
  selectDelay: HUMANIZE_PRESETS.balanced.selectDelay,
  moveDelay:   HUMANIZE_PRESETS.balanced.moveDelay,
  custom:      HUMANIZE_PRESETS.balanced,
});

interface AutoMoveState {
  mode: AutoMoveMode;

  // Hotkey mode
  hotkey1: string;
  hotkey2: string;
  hotkey3: string;
  premoveKey: string;
  premoveDelay: [number, number];

  // Auto mode
  autoPlayDelay: [number, number];
  autoPremove: boolean;
  autoRematch: boolean;
  autoPaused: boolean;
  autoCountdownMs: number | null;
  movePreset: MovePreset;
  moveWeights: [number, number, number];
  moveWeightsCustom: [number, number, number];
  prioritizeForcing: boolean;

  // Humanize — one config per mode (independent)
  humanize: {
    hotkey: HumanizeConfig;
    auto:   HumanizeConfig;
  };

  setMode: (m: AutoMoveMode) => void;
  setHotkey: (slot: 1 | 2 | 3, key: string) => void;
  setPremoveKey: (key: string) => void;
  setPremoveDelay: (v: [number, number]) => void;

  setAutoPlayDelay: (v: [number, number]) => void;
  setAutoPremove: (v: boolean) => void;
  setAutoRematch: (v: boolean) => void;
  setAutoPaused: (v: boolean) => void;
  setAutoCountdown: (ms: number | null) => void;
  setMovePreset: (p: MovePreset) => void;
  setMoveWeight: (i: 0 | 1 | 2, v: number) => void;
  setPrioritizeForcing: (v: boolean) => void;

  setHumanizePreset: (target: HumanizeTarget, p: HumanizePreset) => void;
  setPickDelay:   (target: HumanizeTarget, v: [number, number]) => void;
  setSelectDelay: (target: HumanizeTarget, v: [number, number]) => void;
  setMoveDelay:   (target: HumanizeTarget, v: [number, number]) => void;
  resetToDefaults: () => void;
}

const AUTOMOVE_DEFAULTS = {
  mode: 'off' as AutoMoveMode,
  hotkey1: '1',
  hotkey2: '2',
  hotkey3: '3',
  premoveKey: 'Shift',
  premoveDelay: [500, 1000] as [number, number],
  autoPlayDelay: [650, 1600] as [number, number],
  autoPremove: false,
  autoRematch: false,
  autoPaused: true,
  autoCountdownMs: null as number | null,
  movePreset: 'mostly-best' as MovePreset,
  moveWeights: MOVE_PRESETS['mostly-best'],
  moveWeightsCustom: MOVE_PRESETS['mostly-best'],
  prioritizeForcing: true,
};

export const useAutoMoveStore = create<AutoMoveState>()(
  persist(
    (set, get) => ({
      ...AUTOMOVE_DEFAULTS,

      humanize: {
        hotkey: defaultHumanize(),
        auto:   defaultHumanize(),
      },

      setMode: (m) => set({ mode: m, autoPaused: true, autoCountdownMs: null }),
      setHotkey: (slot, key) => set({ [`hotkey${slot}`]: key } as any),
      setPremoveKey: (premoveKey) => set({ premoveKey }),
      setPremoveDelay: (premoveDelay) => set({ premoveDelay }),

      setAutoPlayDelay: (autoPlayDelay) => set({ autoPlayDelay }),
      setAutoPremove: (autoPremove) => set({ autoPremove }),
      setAutoRematch: (autoRematch) => set({ autoRematch }),
      setAutoPaused: (autoPaused) => set({ autoPaused, autoCountdownMs: autoPaused ? null : get().autoCountdownMs }),
      setAutoCountdown: (autoCountdownMs) => set({ autoCountdownMs }),
      setMovePreset: (movePreset) => {
        if (movePreset === 'manual') {
          set({ movePreset, moveWeights: get().moveWeightsCustom });
        } else {
          set({ movePreset, moveWeights: MOVE_PRESETS[movePreset] });
        }
      },
      setMoveWeight: (i, v) => {
        const current = [...get().moveWeights] as [number, number, number];
        const clamped = Math.max(0, Math.min(100, Math.round(v)));
        const others = [0, 1, 2].filter((x) => x !== i);
        const remaining = 100 - clamped;
        const sumOthers = current[others[0]] + current[others[1]];
        let newWeights: [number, number, number];
        if (sumOthers === 0) {
          newWeights = [0, 0, 0] as any;
          newWeights[i] = clamped;
          newWeights[others[0]] = Math.floor(remaining / 2);
          newWeights[others[1]] = remaining - newWeights[others[0]];
        } else {
          newWeights = [0, 0, 0] as any;
          newWeights[i] = clamped;
          newWeights[others[0]] = Math.round((current[others[0]] / sumOthers) * remaining);
          newWeights[others[1]] = remaining - newWeights[others[0]];
        }
        set({ moveWeights: newWeights, moveWeightsCustom: newWeights, movePreset: 'manual' });
      },
      setPrioritizeForcing: (prioritizeForcing) => set({ prioritizeForcing }),

      setHumanizePreset: (target, preset) => {
        const s = get();
        const cfg = s.humanize[target];
        const next: HumanizeConfig = preset === 'manual'
          ? {
              preset: 'manual',
              pickDelay:   cfg.custom.pickDelay,
              selectDelay: cfg.custom.selectDelay,
              moveDelay:   cfg.custom.moveDelay,
              custom:      cfg.custom,
            }
          : {
              preset,
              pickDelay:   HUMANIZE_PRESETS[preset].pickDelay,
              selectDelay: HUMANIZE_PRESETS[preset].selectDelay,
              moveDelay:   HUMANIZE_PRESETS[preset].moveDelay,
              custom:      cfg.custom,
            };
        set({ humanize: { ...s.humanize, [target]: next } });
      },
      setPickDelay: (target, pickDelay) => {
        const s = get();
        const cfg = s.humanize[target];
        const custom = { pickDelay, selectDelay: cfg.selectDelay, moveDelay: cfg.moveDelay };
        set({ humanize: { ...s.humanize, [target]: { ...cfg, pickDelay, preset: 'manual', custom } } });
      },
      setSelectDelay: (target, selectDelay) => {
        const s = get();
        const cfg = s.humanize[target];
        const custom = { pickDelay: cfg.pickDelay, selectDelay, moveDelay: cfg.moveDelay };
        set({ humanize: { ...s.humanize, [target]: { ...cfg, selectDelay, preset: 'manual', custom } } });
      },
      setMoveDelay: (target, moveDelay) => {
        const s = get();
        const cfg = s.humanize[target];
        const custom = { pickDelay: cfg.pickDelay, selectDelay: cfg.selectDelay, moveDelay };
        set({ humanize: { ...s.humanize, [target]: { ...cfg, moveDelay, preset: 'manual', custom } } });
      },
      resetToDefaults: () => set({
        ...AUTOMOVE_DEFAULTS,
        humanize: { hotkey: defaultHumanize(), auto: defaultHumanize() },
      }),
    }),
    {
      name: 'chessr-auto-move',
      version: 2,
      partialize: (state) => {
        const { autoPaused, autoCountdownMs, ...rest } = state;
        return rest;
      },
    },
  ),
);

// ─── Helpers used by the scheduler ───

/** Randomized delay in a range, biased away from the last value (v2 parity). */
let lastDelay = -1;
export function randomInRangeBiased([min, max]: [number, number]): number {
  const span = max - min;
  if (span <= 0) return min;
  let pick: number;
  if (lastDelay < 0 || Math.random() < 0.3) {
    pick = min + Math.random() * span;
  } else {
    const mid = (min + max) / 2;
    if (lastDelay < mid) pick = mid + Math.random() * (max - mid);
    else                 pick = min + Math.random() * (mid - min);
  }
  lastDelay = pick;
  return Math.round(pick);
}

/** Weighted sample — returns 0, 1, or 2. Renormalizes if one slot is unavailable. */
export function weightedSample(weights: [number, number, number], available: boolean[]): number {
  const effective = weights.map((w, i) => (available[i] ? w : 0));
  const total = effective.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let r = Math.random() * total;
  for (let i = 0; i < 3; i++) {
    r -= effective[i];
    if (r <= 0) return i;
  }
  return 0;
}

/** Format countdown ms for display: seconds with one decimal when ≥ 1s, else ms. */
export function formatCountdown(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Build humanize delays for the current mode, or null if mode is off. */
export function buildHumanizeDelays(s: AutoMoveState): { pickDelay: number; selectDelay: number; moveDelay: number } | null {
  if (s.mode === 'off') return null;
  const target: HumanizeTarget = s.mode === 'auto' ? 'auto' : 'hotkey';
  const cfg = s.humanize[target];
  return {
    pickDelay:   randomInRangeBiased(cfg.pickDelay),
    selectDelay: randomInRangeBiased(cfg.selectDelay),
    moveDelay:   randomInRangeBiased(cfg.moveDelay),
  };
}
