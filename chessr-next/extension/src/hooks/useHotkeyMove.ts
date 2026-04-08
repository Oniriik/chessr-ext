import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { usePlatform } from '../contexts/PlatformContext';
import { executeAutoMove, type HumanizeDelays } from '../lib/chesscom/executeAutoMove';
import { logger } from '../lib/logger';

function getRandomDelay(range: [number, number], lastDelay: number | null): number {
  const [min, max] = range;
  const span = max - min;
  if (span <= 0) return min;

  // Bias away from last delay: split range into lower/upper half relative to last
  // and prefer the opposite half
  if (lastDelay !== null && lastDelay >= min && lastDelay <= max) {
    const mid = (min + max) / 2;
    if (lastDelay < mid) {
      // Last was low → bias upper half (70% chance upper, 30% lower)
      const useUpper = Math.random() < 0.7;
      return useUpper
        ? mid + Math.random() * (max - mid)
        : min + Math.random() * (mid - min);
    } else {
      // Last was high → bias lower half
      const useLower = Math.random() < 0.7;
      return useLower
        ? min + Math.random() * (mid - min)
        : mid + Math.random() * (max - mid);
    }
  }

  return min + Math.random() * span;
}

export function useHotkeyMove() {
  const { platform } = usePlatform();
  const isChesscom = platform.id === 'chesscom';
  const hotkeyMoveEnabled = useSettingsStore((s) => s.hotkeyMoveEnabled);
  const firstHotkey = useSettingsStore((s) => s.firstHotkey);
  const secondHotkey = useSettingsStore((s) => s.secondHotkey);
  const thirdHotkey = useSettingsStore((s) => s.thirdHotkey);
  const premoveHotkey = useSettingsStore((s) => s.premoveHotkey);
  const premoveDelayRange = useSettingsStore((s) => s.premoveDelayRange);
  const humanizeEnabled = useSettingsStore((s) => s.humanizeEnabled);
  const pickDelayRange = useSettingsStore((s) => s.pickDelayRange);
  const selectDelayRange = useSettingsStore((s) => s.selectDelayRange);
  const moveDelayRange = useSettingsStore((s) => s.moveDelayRange);
  const premoveHeldRef = useRef(false);
  const premoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDelayRef = useRef<number | null>(null);


  useEffect(() => {
    if (!hotkeyMoveEnabled) return;

    // Check if premove modifier is active via modifier keys or custom key
    const isPremoveHeld = (e: KeyboardEvent): boolean => {
      if (premoveHotkey === 'Shift') return e.shiftKey;
      if (premoveHotkey === 'Control') return e.ctrlKey;
      if (premoveHotkey === 'Alt') return e.altKey;
      if (premoveHotkey === 'Meta') return e.metaKey;
      return premoveHeldRef.current;
    };

    // Match hotkey using e.code for number keys (immune to Shift)
    const getHotkeyIndex = (e: KeyboardEvent): number => {
      const code = e.code; // e.g. "Digit1", "KeyA"
      const key = e.key;
      const matchKey = (hotkey: string): boolean => {
        if (hotkey >= '0' && hotkey <= '9') return code === `Digit${hotkey}`;
        return key.toLowerCase() === hotkey.toLowerCase();
      };
      if (matchKey(firstHotkey)) return 0;
      if (matchKey(secondHotkey)) return 1;
      if (matchKey(thirdHotkey)) return 2;
      return -1;
    };

    const getHumanizeDelays = (): HumanizeDelays | undefined => {
      if (!humanizeEnabled) return undefined;
      return {
        pickDelay: getRandomDelay(pickDelayRange, null),
        selectDelay: getRandomDelay(selectDelayRange, null),
        moveDelay: getRandomDelay(moveDelayRange, null),
      };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Track non-modifier premove key
      if (e.key === premoveHotkey && !['Shift', 'Control', 'Alt', 'Meta'].includes(premoveHotkey)) {
        premoveHeldRef.current = true;
        return;
      }

      // Skip if typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const { isGameStarted } = useGameStore.getState();
      if (!isGameStarted) return;

      const { suggestions } = useSuggestionStore.getState();
      if (suggestions.length === 0) return;

      const index = getHotkeyIndex(e);
      if (index < 0 || index >= suggestions.length) return;

      e.preventDefault();
      const move = suggestions[index].move;

      if (isPremoveHeld(e) && isChesscom) {
        // Premove: play current move NOW, then queue next PV move after delay
        const { playerColor, currentTurn } = useGameStore.getState();
        if (playerColor !== currentTurn) return;

        // Get the next move from PV (our move is pv[0], opponent's response is pv[1], our next is pv[2])
        const pv = suggestions[index].pv;
        const nextMove = pv && pv.length >= 3 ? pv[2] : null;

        // 1. Play the selected move immediately
        logger.log(`[HotkeyMove] Playing suggestion ${index + 1}: ${move}`);
        executeAutoMove(move, getHumanizeDelays());

        if (!nextMove) {
          logger.log('[HotkeyMove] No next move in PV, skipping premove');
        } else {
          // 2. Play pv[2] after delay as a premove (before opponent plays)
          if (premoveTimerRef.current) clearTimeout(premoveTimerRef.current);

          const delay = getRandomDelay(premoveDelayRange, lastDelayRef.current);
          lastDelayRef.current = delay;
          const moveCountAtQueue = useGameStore.getState().moveHistory.length;
          logger.log(`[HotkeyMove] Premove ${nextMove} in ${Math.round(delay)}ms`);

          premoveTimerRef.current = setTimeout(() => {
            // Cancel if opponent already played
            const currentMoveCount = useGameStore.getState().moveHistory.length;
            if (currentMoveCount > moveCountAtQueue + 1) {
              logger.log('[HotkeyMove] Opponent played, cancelling premove');
              premoveTimerRef.current = null;
              return;
            }
            logger.log(`[HotkeyMove] Premove executing: ${nextMove}`);
            executeAutoMove(nextMove, getHumanizeDelays());
            premoveTimerRef.current = null;
          }, delay);
        }
      } else {
        // Normal move: play immediately if it's our turn
        const { playerColor, currentTurn } = useGameStore.getState();
        if (playerColor !== currentTurn) return;
        logger.log(`[HotkeyMove] Playing suggestion ${index + 1}: ${move}`);
        executeAutoMove(move, getHumanizeDelays());
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === premoveHotkey) {
        premoveHeldRef.current = false;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      if (premoveTimerRef.current) clearTimeout(premoveTimerRef.current);
    };
  }, [hotkeyMoveEnabled, firstHotkey, secondHotkey, thirdHotkey, premoveHotkey, premoveDelayRange, humanizeEnabled, pickDelayRange, selectDelayRange, moveDelayRange]);
}
