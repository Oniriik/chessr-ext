/**
 * layoutStore — Component order, pin state, widget position, edit mode
 */

import { create } from 'zustand';

export interface LayoutConfig {
  gameOrder: string[];
  engineOrder: string[];
  pinned: string[];
  widgetPosition: { x: number; y: number };
}

const DEFAULTS: LayoutConfig = {
  gameOrder: ['performance', 'suggestions'],
  engineOrder: ['elo', 'personality', 'dynamism', 'kingsafety', 'variety'],
  pinned: [],
  widgetPosition: { x: 20, y: 20 },
};

interface LayoutState extends LayoutConfig {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  setOrder: (tab: 'game' | 'engine', order: string[]) => void;
  togglePin: (id: string) => void;
  reorderPinned: (order: string[]) => void;
  setWidgetPosition: (x: number, y: number) => void;
  loadFromCloud: (config: Partial<LayoutConfig>) => void;
  getConfig: () => LayoutConfig;
  resetToDefaults: () => void;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  ...DEFAULTS,
  editMode: false,

  setEditMode: (v) => set({ editMode: v }),

  setOrder: (tab, order) => {
    if (tab === 'game') set({ gameOrder: order });
    else set({ engineOrder: order });
  },

  togglePin: (id) => {
    const { pinned } = get();
    if (pinned.includes(id)) {
      set({ pinned: pinned.filter((p) => p !== id) });
    } else {
      set({ pinned: [...pinned, id] });
    }
  },

  reorderPinned: (order) => set({ pinned: order }),
  setWidgetPosition: (x, y) => set({ widgetPosition: { x, y } }),

  loadFromCloud: (config) => {
    // Merge saved order with current defaults:
    //   - drop any ID that's no longer part of the valid set (e.g. 'ambition'
    //     removed when the Contempt slider was replaced by Dynamism + King Safety)
    //   - append missing defaults to the tail so new controls become visible
    const mergeOrder = (saved: string[] | undefined, defaults: string[]) => {
      const validSet = new Set(defaults);
      const base = (saved ?? []).filter((id) => validSet.has(id));
      const missing = defaults.filter((id) => !base.includes(id));
      return [...base, ...missing];
    };

    set({
      gameOrder: mergeOrder(config.gameOrder, DEFAULTS.gameOrder),
      engineOrder: mergeOrder(config.engineOrder, DEFAULTS.engineOrder),
      pinned: config.pinned ?? DEFAULTS.pinned,
      widgetPosition: config.widgetPosition ?? DEFAULTS.widgetPosition,
    });
  },

  getConfig: () => {
    const { gameOrder, engineOrder, pinned, widgetPosition } = get();
    return { gameOrder, engineOrder, pinned, widgetPosition };
  },

  resetToDefaults: () => set({ ...DEFAULTS, editMode: false }),
}));
