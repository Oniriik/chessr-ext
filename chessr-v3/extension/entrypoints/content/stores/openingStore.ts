import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SelectedOpening {
  eco: string;
  name: string;
  uci: string;
}

interface OpeningState {
  selectedOpenings: SelectedOpening[];
  theoryArrowEnabled: boolean;
  theoryArrowColor: string;
  deviationArrowEnabled: boolean;
  deviationArrowColor: string;
  sideFilter: 'white' | 'black' | 'both';

  addOpening: (o: SelectedOpening) => void;
  removeOpening: (eco: string) => void;
  setTheoryArrowEnabled: (v: boolean) => void;
  setTheoryArrowColor: (c: string) => void;
  setDeviationArrowEnabled: (v: boolean) => void;
  setDeviationArrowColor: (c: string) => void;
  setSideFilter: (s: 'white' | 'black' | 'both') => void;

  loadFromCloud: (data: Record<string, unknown>) => void;
  getPayload: () => Record<string, unknown>;
}

const DEFAULTS = {
  selectedOpenings: [] as SelectedOpening[],
  theoryArrowEnabled: true,
  theoryArrowColor: '#D5A47D',
  deviationArrowEnabled: true,
  deviationArrowColor: '#fde047',
  sideFilter: 'both' as const,
};

export const useOpeningStore = create<OpeningState>()(persist((set, get) => ({
  ...DEFAULTS,

  addOpening: (o) => {
    const current = get().selectedOpenings;
    if (current.length >= 3 || current.some((x) => x.eco === o.eco)) return;
    set({ selectedOpenings: [...current, o] });
  },
  removeOpening: (eco) => {
    set({ selectedOpenings: get().selectedOpenings.filter((o) => o.eco !== eco) });
  },
  setTheoryArrowEnabled: (v) => set({ theoryArrowEnabled: v }),
  setTheoryArrowColor: (c) => set({ theoryArrowColor: c }),
  setDeviationArrowEnabled: (v) => set({ deviationArrowEnabled: v }),
  setDeviationArrowColor: (c) => set({ deviationArrowColor: c }),
  setSideFilter: (s) => set({ sideFilter: s }),

  loadFromCloud: (data) => {
    set({
      selectedOpenings: (data.selectedOpenings as SelectedOpening[] | undefined) ?? DEFAULTS.selectedOpenings,
      theoryArrowEnabled: (data.theoryArrowEnabled as boolean | undefined) ?? DEFAULTS.theoryArrowEnabled,
      theoryArrowColor: (data.theoryArrowColor as string | undefined) ?? DEFAULTS.theoryArrowColor,
      deviationArrowEnabled: (data.deviationArrowEnabled as boolean | undefined) ?? DEFAULTS.deviationArrowEnabled,
      deviationArrowColor: (data.deviationArrowColor as string | undefined) ?? DEFAULTS.deviationArrowColor,
      sideFilter: (data.sideFilter as 'white' | 'black' | 'both' | undefined) ?? DEFAULTS.sideFilter,
    });
  },

  getPayload: () => {
    const s = get();
    return {
      selectedOpenings: s.selectedOpenings,
      theoryArrowEnabled: s.theoryArrowEnabled,
      theoryArrowColor: s.theoryArrowColor,
      deviationArrowEnabled: s.deviationArrowEnabled,
      deviationArrowColor: s.deviationArrowColor,
      sideFilter: s.sideFilter,
    };
  },
}), { name: 'chessr-opening' }));
