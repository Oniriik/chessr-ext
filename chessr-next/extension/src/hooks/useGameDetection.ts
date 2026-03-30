import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useEngineStore } from '../stores/engineStore';
import { usePlatform } from '../contexts/PlatformContext';
import { getRealHref } from '../content/anonymousBlur';
import { logger } from '../lib/logger';
import * as chesscom from '../platforms/chesscom';
import * as lichess from '../platforms/lichess';
import * as worldchess from '../platforms/worldchess';

// Platform-specific selectors
const PLATFORM_CONFIG = {
  chesscom: {
    moveListSelector: '.play-controller-moves, .move-list, [class*="vertical-move-list"]',
    moveSelector: '.main-line-ply',
  },
  lichess: {
    moveListSelector: 'rm6, l4x, .moves',
    moveSelector: 'kwdb',
  },
  worldchess: {
    moveListSelector: '[data-component="GameNotationTable"]',
    moveSelector: 'button[id^="move_"][id$="_table"]',
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
  const platformModule = platformId === 'lichess' ? lichess : platformId === 'worldchess' ? worldchess : chesscom;

  useEffect(() => {
    logger.log(`[useGameDetection] URL changed or init (${platformId}):`, currentUrl);

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
    // Periodic check to detect if the move list element was replaced by the platform
    // (Lichess replaces DOM elements mid-game, which silently breaks MutationObserver)
    let moveListValidityCheck: ReturnType<typeof setInterval> | null = null;
    let currentMoveListEl: Element | null = null;

    const startMoveListObserver = () => {
      const moveList = document.querySelector(config.moveListSelector);
      if (!moveList) return;
      currentMoveListEl = moveList;

      // Get initial move count
      const moves = moveList.querySelectorAll(config.moveSelector);
      lastMoveCount.current = moves.length;

      moveListObserver.current = new MutationObserver(() => {
        const currentMoves = moveList.querySelectorAll(config.moveSelector);

        // Detect game reset (move count dropped to 0 or 1)
        if (currentMoves.length <= 1 && lastMoveCount.current > 1) {
          logger.log('[useGameDetection] Game reset detected');
          reset();
          moveListObserver.current?.disconnect();
          lastMoveCount.current = 0;
          if (platformModule.detectGameStarted()) {
            setGameStarted(true);
            setPlayerColor(platformModule.detectPlayerColor());
            startMoveListObserver();
          } else {
            startDocumentObserver();
          }
          return;
        }

        if (currentMoves.length !== lastMoveCount.current) {
          lastMoveCount.current = currentMoves.length;
          syncFromDOM();
        }
      });

      moveListObserver.current.observe(moveList, {
        childList: true,
        subtree: true,
      });

      // Check every second if the move list element was replaced
      if (moveListValidityCheck) clearInterval(moveListValidityCheck);
      moveListValidityCheck = setInterval(() => {
        const stillConnected = currentMoveListEl?.isConnected;
        if (!stillConnected) {
          logger.warn('[useGameDetection] Move list disconnected, recovering...');
          moveListObserver.current?.disconnect();
          const newMoveList = document.querySelector(config.moveListSelector);
          if (newMoveList) {
            currentMoveListEl = newMoveList;
            const newMoves = newMoveList.querySelectorAll(config.moveSelector);
            lastMoveCount.current = newMoves.length;
            syncFromDOM();
            moveListObserver.current = new MutationObserver(() => {
              const currentMoves = newMoveList.querySelectorAll(config.moveSelector);
              if (currentMoves.length !== lastMoveCount.current) {
                lastMoveCount.current = currentMoves.length;
                syncFromDOM();
              }
            });
            moveListObserver.current.observe(newMoveList, { childList: true, subtree: true });
          } else if (!platformModule.detectGameStarted()) {
            if (moveListValidityCheck) clearInterval(moveListValidityCheck);
            reset();
            startDocumentObserver();
          }
        }
      }, 1000);
    };

    // Watch for the game to appear in the DOM
    const startDocumentObserver = () => {
      documentObserver.current?.disconnect();
      documentObserver.current = new MutationObserver(() => {
        if (initDetection()) {
          documentObserver.current?.disconnect();
        }
      });
      documentObserver.current.observe(document.body, {
        childList: true,
        subtree: true,
      });
    };

    // If game not started, watch for the move list to appear
    if (!initDetection()) {
      startDocumentObserver();
    }

    // Cleanup
    return () => {
      moveListObserver.current?.disconnect();
      documentObserver.current?.disconnect();
      if (moveListValidityCheck) clearInterval(moveListValidityCheck);
    };
  }, [currentUrl, platformId, config, platformModule, setGameStarted, setPlayerColor, setCurrentTurn, syncFromDOM, reset, detectFromDOM]);
}
