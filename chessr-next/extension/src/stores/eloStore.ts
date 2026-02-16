import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { detectRatings } from '../platforms/chesscom';

interface EloState {
  // Detected values
  userElo: number;
  opponentElo: number;

  // Auto mode toggles
  targetEloAuto: boolean;
  opponentEloAuto: boolean;

  // Manual values (used when auto is off)
  targetEloManual: number;
  opponentEloManual: number;

  // Computed getters
  getTargetElo: () => number;
  getOpponentElo: () => number;

  // Actions
  setUserElo: (elo: number) => void;
  setOpponentElo: (elo: number) => void;
  setTargetEloAuto: (auto: boolean) => void;
  setOpponentEloAuto: (auto: boolean) => void;
  setTargetEloManual: (elo: number) => void;
  setOpponentEloManual: (elo: number) => void;

  // Auto-detect from DOM
  detectFromDOM: () => void;
}

export const useEloStore = create<EloState>()(
  persist(
    (set, get) => ({
      // Initial values
      userElo: 1500,
      opponentElo: 1500,
      targetEloAuto: true,
      opponentEloAuto: true,
      targetEloManual: 1650,
      opponentEloManual: 1500,

      // Target ELO: auto = userElo + 150, manual = slider value
      getTargetElo: () => {
        const { targetEloAuto, userElo, targetEloManual } = get();
        return targetEloAuto ? userElo + 150 : targetEloManual;
      },

      // Opponent ELO: auto = detected, manual = slider value
      getOpponentElo: () => {
        const { opponentEloAuto, opponentElo, opponentEloManual } = get();
        return opponentEloAuto ? opponentElo : opponentEloManual;
      },

      // Setters
      setUserElo: (elo) => set({ userElo: elo }),
      setOpponentElo: (elo) => set({ opponentElo: elo }),
      setTargetEloAuto: (auto) => set({ targetEloAuto: auto }),
      setOpponentEloAuto: (auto) => set({ opponentEloAuto: auto }),
      setTargetEloManual: (elo) => set({ targetEloManual: elo }),
      setOpponentEloManual: (elo) => set({ opponentEloManual: elo }),

      // Detect ratings from Chess.com DOM
      detectFromDOM: () => {
        const ratings = detectRatings();

        if (ratings.playerRating) {
          set({ userElo: ratings.playerRating });
        }
        if (ratings.opponentRating) {
          set({ opponentElo: ratings.opponentRating });
        }
      },
    }),
    {
      name: 'chessr-elo',
      partialize: (state) => ({
        targetEloAuto: state.targetEloAuto,
        opponentEloAuto: state.opponentEloAuto,
        targetEloManual: state.targetEloManual,
        opponentEloManual: state.opponentEloManual,
      }),
    }
  )
);
