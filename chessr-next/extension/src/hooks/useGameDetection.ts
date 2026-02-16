import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useEngineStore } from '../stores/engineStore';
import {
  detectGameStarted,
  detectPlayerColor,
  detectCurrentTurn,
} from '../platforms/chesscom';

const MOVE_LIST_SELECTOR = '.play-controller-moves, .move-list, [class*="vertical-move-list"]';
const MOVE_SELECTOR = '.main-line-ply';

/**
 * Hook that handles game detection:
 * 1. Waits for the move list to appear (game started)
 * 2. Detects player color and current turn
 * 3. Observes move list for turn changes
 * 4. Syncs chess.js state from DOM
 */
export function useGameDetection() {
  const { setGameStarted, setPlayerColor, setCurrentTurn, syncFromDOM, reset } =
    useGameStore();
  const { detectFromDOM } = useEngineStore();
  const moveListObserver = useRef<MutationObserver | null>(null);
  const documentObserver = useRef<MutationObserver | null>(null);
  const lastMoveCount = useRef<number>(0);

  useEffect(() => {
    // Try to detect if game is already started
    const initDetection = () => {
      const isStarted = detectGameStarted();

      if (isStarted) {
        setGameStarted(true);
        setPlayerColor(detectPlayerColor());
        setCurrentTurn(detectCurrentTurn());

        // Initial sync of chess.js state
        syncFromDOM();

        // Detect ELO from DOM
        detectFromDOM();

        startMoveListObserver();
        return true;
      }
      return false;
    };

    // Start observing the move list for new moves
    const startMoveListObserver = () => {
      const moveList = document.querySelector(MOVE_LIST_SELECTOR);
      if (!moveList) return;

      // Get initial move count
      const moves = moveList.querySelectorAll(MOVE_SELECTOR);
      lastMoveCount.current = moves.length;

      moveListObserver.current = new MutationObserver(() => {
        const currentMoves = moveList.querySelectorAll(MOVE_SELECTOR);

        // Detect game reset (move count dropped to 0 or 1)
        if (currentMoves.length <= 1 && lastMoveCount.current > 1) {
          console.log('[useGameDetection] Game reset detected');
          reset();
          setGameStarted(true);
          setPlayerColor(detectPlayerColor());
        }

        if (currentMoves.length !== lastMoveCount.current) {
          lastMoveCount.current = currentMoves.length;

          // Sync chess.js state (this also updates currentTurn)
          syncFromDOM();
        }
      });

      moveListObserver.current.observe(moveList, {
        childList: true,
        subtree: true,
      });
    };

    // If game not started, watch for the move list to appear
    if (!initDetection()) {
      documentObserver.current = new MutationObserver(() => {
        if (initDetection()) {
          // Stop watching once game is detected
          documentObserver.current?.disconnect();
        }
      });

      documentObserver.current.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    // Cleanup
    return () => {
      moveListObserver.current?.disconnect();
      documentObserver.current?.disconnect();
    };
  }, [setGameStarted, setPlayerColor, setCurrentTurn, syncFromDOM, reset, detectFromDOM]);
}
