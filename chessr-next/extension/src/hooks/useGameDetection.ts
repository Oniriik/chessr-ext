import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useEngineStore } from '../stores/engineStore';
import { usePlatform } from '../contexts/PlatformContext';
import { getRealHref } from '../content/anonymousBlur';
import * as chesscom from '../platforms/chesscom';
import * as lichess from '../platforms/lichess';

// Platform-specific selectors
const PLATFORM_CONFIG = {
  chesscom: {
    moveListSelector: '.play-controller-moves, .move-list, [class*="vertical-move-list"]',
    moveSelector: '.main-line-ply',
  },
  lichess: {
    moveListSelector: 'rm6, .moves',
    moveSelector: 'kwdb',
  },
} as const;

/**
 * Hook to detect URL changes (SPA navigation)
 */
function useUrlChange() {
  const [url, setUrl] = useState(getRealHref());

  useEffect(() => {
    let lastUrl = getRealHref();

    // Check URL periodically (handles pushState/replaceState)
    const interval = setInterval(() => {
      const currentReal = getRealHref();
      if (currentReal !== lastUrl) {
        lastUrl = currentReal;
        setUrl(lastUrl);
      }
    }, 500);

    // Also listen for popstate (back/forward)
    const handlePopState = () => {
      setUrl(getRealHref());
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      clearInterval(interval);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return url;
}

/**
 * Hook that handles game detection:
 * 1. Waits for the move list to appear (game started)
 * 2. Detects player color and current turn
 * 3. Observes move list for turn changes
 * 4. Syncs chess.js state from DOM
 */
export function useGameDetection() {
  const { platform } = usePlatform();
  const { setGameStarted, setPlayerColor, setCurrentTurn, syncFromDOM, reset } =
    useGameStore();
  const { detectFromDOM } = useEngineStore();
  const moveListObserver = useRef<MutationObserver | null>(null);
  const documentObserver = useRef<MutationObserver | null>(null);
  const lastMoveCount = useRef<number>(0);

  // Track URL changes for SPA navigation
  const currentUrl = useUrlChange();

  // Get platform-specific functions and selectors
  const platformId = platform.id;
  const config = PLATFORM_CONFIG[platformId];
  const platformModule = platformId === 'lichess' ? lichess : chesscom;

  useEffect(() => {
    console.log(`[useGameDetection] URL changed or init (${platformId}):`, currentUrl);

    // Reset state when URL changes
    reset();
    moveListObserver.current?.disconnect();
    documentObserver.current?.disconnect();
    lastMoveCount.current = 0;

    // Try to detect if game is already started
    const initDetection = () => {
      const isStarted = platformModule.detectGameStarted();

      if (isStarted) {
        setGameStarted(true);
        setPlayerColor(platformModule.detectPlayerColor());
        setCurrentTurn(platformModule.detectCurrentTurn());

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
      const moveList = document.querySelector(config.moveListSelector);
      if (!moveList) return;

      // Get initial move count
      const moves = moveList.querySelectorAll(config.moveSelector);
      lastMoveCount.current = moves.length;

      moveListObserver.current = new MutationObserver(() => {
        const currentMoves = moveList.querySelectorAll(config.moveSelector);

        // Detect game reset (move count dropped to 0 or 1)
        if (currentMoves.length <= 1 && lastMoveCount.current > 1) {
          console.log('[useGameDetection] Game reset detected');
          reset();
          setGameStarted(true);
          setPlayerColor(platformModule.detectPlayerColor());
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
  }, [currentUrl, platformId, config, platformModule, setGameStarted, setPlayerColor, setCurrentTurn, syncFromDOM, reset, detectFromDOM]);
}
