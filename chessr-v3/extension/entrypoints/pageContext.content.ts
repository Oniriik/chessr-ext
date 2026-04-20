export default defineContentScript({
  matches: ['*://chess.com/*', '*://*.chess.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    let board: any = null;
    let currentGame: any = null;
    let patched = false;
    let lastMode: string | null = null;

    function getBoard() {
      return document.querySelector('wc-chess-board') as any;
    }

    function getGameEndInfo(game: any) {
      const info = game.getPositionInfo();
      if (!info?.gameOver) return null;
      return { checkmate: !!info.checkmate, stalemate: !!info.stalemate, draw: !!info.draw, threefold: !!info.threefold, insufficient: !!info.insufficient, fiftyMoveRule: !!info.fiftyMoveRule };
    }

    function patchGame(game: any) {
      if (!game || patched) return;
      patched = true;
      lastMode = game.getMode()?.name || null;

      const originalMove = game.move.bind(game);
      game.move = function (moveData: any) {
        const result = originalMove(moveData);
        window.postMessage({
          type: 'chessr:move',
          fen: game.getFEN(),
          gameOver: game.getPositionInfo()?.gameOver || false,
          gameEnd: getGameEndInfo(game),
          turn: game.getTurn(),
        }, '*');
        return result;
      };

      // Listen for game reset
      game.on('ResetGame', () => {
        console.log('[Chessr pageContext] ResetGame event');
        window.postMessage({ type: 'chessr:newGame' }, '*');
        lastMode = game.getMode()?.name || null;
        window.postMessage({
          type: 'chessr:mode',
          name: lastMode,
          playingAs: game.getPlayingAs(),
        }, '*');
        window.postMessage({
          type: 'chessr:move',
          fen: game.getFEN(),
          gameOver: game.getPositionInfo()?.gameOver || false,
          gameEnd: getGameEndInfo(game),
          turn: game.getTurn(),
        }, '*');
      });

      // Listen for mode changes (e.g. passive-observing → playing, playing → observing)
      game.on('ModeChanged', (event: any) => {
        const newMode = event.data;
        const wasPlaying = lastMode === 'playing';
        const nowPlaying = newMode === 'playing';
        lastMode = newMode;
        console.log('[Chessr pageContext] ModeChanged', newMode, wasPlaying ? '(was playing)' : '');

        // Transition INTO 'playing' = new game starting. Chess.com often reuses
        // the same game object, so stale result / gameOver values may still be
        // reported for a moment — force a fresh-state frame instead of trusting
        // getPositionInfo / getResult.
        if (nowPlaying && !wasPlaying) {
          window.postMessage({ type: 'chessr:newGame' }, '*');
          const refreshState = () => {
            window.postMessage({
              type: 'chessr:mode',
              name: 'playing',
              playingAs: game.getPlayingAs(),
              fen: game.getFEN(),
              gameOver: false,
              gameEnd: null,
              turn: game.getTurn(),
              result: '*',
            }, '*');
          };
          refreshState();
          setTimeout(refreshState, 150);
          setTimeout(refreshState, 500);
          return;
        }

        // If mode changed FROM playing to non-playing, the game is over
        // Use getResult() as the source of truth (handles resign, timeout, abandon, etc.)
        const posGameOver = game.getPositionInfo()?.gameOver || false;
        const gameResult = game.getResult?.() || '*';
        const isGameOver = posGameOver || (wasPlaying && !nowPlaying) || (gameResult !== '*');

        window.postMessage({
          type: 'chessr:mode',
          name: newMode,
          playingAs: game.getPlayingAs(),
          fen: game.getFEN(),
          gameOver: isGameOver,
          gameEnd: getGameEndInfo(game),
          turn: game.getTurn(),
          result: gameResult,
        }, '*');
      });

      // Listen for UpdatePGNHeaders — catches game result set by server (resign, timeout, etc.)
      game.on('UpdatePGNHeaders', (event: any) => {
        const headers = event.data;
        if (headers?.Result && headers.Result !== '*') {
          console.log('[Chessr pageContext] Game result from PGN:', headers.Result);
          window.postMessage({
            type: 'chessr:gameOver',
            result: headers.Result,
            fen: game.getFEN(),
            turn: game.getTurn(),
            gameEnd: getGameEndInfo(game),
          }, '*');
        }
      });

      // Send initial state (mode + fen in one message to avoid race).
      // On SPA nav, playingAs / turn / fen may not be populated synchronously
      // when the game is first attached — resend a few times to catch up.
      const sendInitialState = () => {
        const m = game.getMode();
        const modeName = m?.name || null;
        const playing = modeName === 'playing';
        // While mode is 'playing', ignore stale position/result flags — they
        // can linger from a previous game that reused the same object.
        window.postMessage({
          type: 'chessr:mode',
          name: modeName,
          playingAs: game.getPlayingAs(),
          fen: game.getFEN(),
          gameOver: playing ? false : (game.getPositionInfo()?.gameOver || false),
          turn: game.getTurn(),
          result: playing ? '*' : (game.getResult?.() || '*'),
        }, '*');
      };
      sendInitialState();
      setTimeout(sendInitialState, 150);
      setTimeout(sendInitialState, 500);
      setTimeout(sendInitialState, 1500);

      // Detect ratings after a short delay (DOM needs to render)
      setTimeout(detectRatings, 500);
    }

    // Read the game from the board bypassing our getter (use prototype or stored ref)
    function getRawGame(b: any): any {
      // If we haven't overridden yet, just read directly
      const desc = Object.getOwnPropertyDescriptor(b, 'game');
      if (!desc?.get) return b.game;
      // Our getter returns currentGame — but the real game may have changed internally
      // Delete our override temporarily, read real value, re-install
      delete b.game;
      const real = b.game;
      // Re-install our override
      Object.defineProperty(b, 'game', {
        get() { return currentGame; },
        set(newGame: any) {
          currentGame = newGame;
          patched = false;
          if (newGame) {
            window.postMessage({ type: 'chessr:newGame' }, '*');
            patchGame(newGame);
          }
        },
        configurable: true,
      });
      return real;
    }

    function watchBoard() {
      const newBoard = getBoard();
      if (!newBoard) return;

      const isNewBoard = newBoard !== board;
      if (isNewBoard) {
        board = newBoard;
        patched = false;
      }

      // Check if the real game object changed (Chess.com may bypass our setter on SPA nav)
      const rawGame = isNewBoard ? board.game : getRawGame(board);
      if (rawGame && rawGame !== currentGame) {
        const isFirst = currentGame === null;
        currentGame = rawGame;
        patched = false;
        if (!isFirst) {
          window.postMessage({ type: 'chessr:newGame' }, '*');
        }
        patchGame(rawGame);
      }

      // Install property override on new board elements
      if (isNewBoard) {
        Object.defineProperty(board, 'game', {
          get() { return currentGame; },
          set(newGame: any) {
            currentGame = newGame;
            patched = false;
            if (newGame) {
              window.postMessage({ type: 'chessr:newGame' }, '*');
              patchGame(newGame);
            }
          },
          configurable: true,
        });
      }
    }

    // ========== Anonymous Names Blur ==========
    const BLUR_CLASS = 'chessr-anon-blur';
    const BLUR_STYLE_ID = 'chessr-anon-style';
    const USERNAME_SELECTORS = '.user-username, .user-tagline-username, .cc-user-username-component, .user-username-component, .game-overview-player, .battle-player-username, .modal-game-over-user-username, a[data-user-activity-key="profile"] .sidebar-link-text';

    // Inject blur CSS once (defer if head not ready yet at document_start)
    function injectBlurStyle() {
      if (document.getElementById(BLUR_STYLE_ID)) return;
      const target = document.head || document.documentElement;
      if (!target) return;
      const style = document.createElement('style');
      style.id = BLUR_STYLE_ID;
      style.textContent = `.${BLUR_CLASS} { filter: blur(5px) !important; user-select: none !important; }`;
      target.appendChild(style);
    }
    if (document.head) {
      injectBlurStyle();
    } else {
      document.addEventListener('DOMContentLoaded', injectBlurStyle, { once: true });
    }

    let anonActive = false;
    try { anonActive = localStorage.getItem('chessr-anon') === 'true'; } catch {}

    function applyBlur() {
      document.querySelectorAll(USERNAME_SELECTORS).forEach((el) => {
        if (!el.classList.contains(BLUR_CLASS)) el.classList.add(BLUR_CLASS);
      });
    }

    function removeBlur() {
      document.querySelectorAll(`.${BLUR_CLASS}`).forEach((el) => el.classList.remove(BLUR_CLASS));
    }

    if (anonActive) applyBlur();

    // Watch for new DOM nodes to blur
    const blurObserver = new MutationObserver((mutations) => {
      if (!anonActive) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) applyBlur();
        }
      }
    });
    blurObserver.observe(document.documentElement, { childList: true, subtree: true });

    // Listen for toggle from content script
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'chessr:setAnon') {
        anonActive = !!e.data.value;
        try { localStorage.setItem('chessr-anon', anonActive ? 'true' : 'false'); } catch {}
        anonActive ? applyBlur() : removeBlur();
      }
    });

    // ========== Fake Title (GM/IM/FM…) ==========
    const TITLE_CLASS = 'chessr-mock-title';
    const TITLE_FULL_NAMES: Record<string, string> = {
      GM: 'Grandmaster',
      IM: 'International Master',
      FM: 'FIDE Master',
      NM: 'National Master',
      CM: 'FIDE Candidate Master',
      WGM: 'Woman Grandmaster',
      WIM: 'Woman International Master',
      WFM: 'Woman FIDE Master',
      WCM: 'FIDE Woman Candidate Master',
      WNM: 'Woman National Master',
    };

    let titleActive = false;
    let titleText = 'GM';
    try {
      titleActive = localStorage.getItem('chessr-title') === 'true';
      titleText = localStorage.getItem('chessr-title-type') || 'GM';
    } catch {}

    let titleDebounce: ReturnType<typeof setTimeout> | null = null;

    function getChessComUsername(): string | null {
      const profileLink = document.querySelector('[data-user-activity-key="profile"] .sidebar-link-text');
      if (profileLink?.textContent?.trim()) return profileLink.textContent.trim();
      const navLinkName = document.querySelector('.nav-link-name');
      if (navLinkName?.textContent?.trim()) return navLinkName.textContent.trim();
      const navHeader = document.querySelector('.nav-user-header-username');
      if (navHeader?.textContent?.trim()) return navHeader.textContent.trim();
      const profileAnchor = document.querySelector('a[data-user-activity-key="profile"]') as HTMLAnchorElement | null;
      if (profileAnchor?.href) {
        const parts = profileAnchor.href.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        if (last) return last;
      }
      if (!document.documentElement.classList.contains('user-logged-in')) return null;
      return null;
    }

    function removeMockTitles() {
      document.querySelectorAll(`.${TITLE_CLASS}`).forEach((el) => el.remove());
    }

    function injectGameTitle(targetLower: string) {
      const containers = document.querySelectorAll('.player-tagline, .cc-user-block-component, .user-block-component');
      containers.forEach((container) => {
        const nameEl = container.querySelector('[data-test-element="user-tagline-username"]');
        if (!nameEl) return;
        if (nameEl.textContent?.trim().toLowerCase() !== targetLower) return;
        if (container.querySelector(`.${TITLE_CLASS}`)) return;
        const title = document.createElement('a');
        title.className = `cc-user-title-component cc-text-x-small-bold ${TITLE_CLASS}`;
        title.href = '/members/titled-players';
        title.target = '_blank';
        title.textContent = titleText;
        nameEl.parentNode?.insertBefore(title, nameEl);
      });
    }

    function injectProfileTitle(targetLower: string) {
      const url = new URL(location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const memberIdx = parts.indexOf('member');
      if (memberIdx === -1) return;
      const profileUsername = parts[memberIdx + 1]?.toLowerCase();
      if (!profileUsername || profileUsername !== targetLower) return;
      const usernameEl = document.querySelector('.profile-card-username');
      if (!usernameEl) return;
      if (usernameEl.parentElement?.querySelector(`.${TITLE_CLASS}`)) return;
      const title = document.createElement('a');
      title.href = '/members/titled-players';
      title.className = `profile-card-chesstitle ${TITLE_CLASS}`;
      title.setAttribute('v-tooltip', TITLE_FULL_NAMES[titleText] || titleText);
      title.textContent = titleText;
      usernameEl.parentElement?.insertBefore(title, usernameEl);
    }

    function injectProfileBadge(targetLower: string) {
      const badgesSection = document.querySelector('.profile-badges');
      if (!badgesSection) return;
      if (badgesSection.querySelector(`.${TITLE_CLASS}`)) return;
      const url = new URL(location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const memberIdx = parts.indexOf('member');
      if (memberIdx === -1) return;
      const profileUsername = parts[memberIdx + 1]?.toLowerCase();
      if (!profileUsername || profileUsername !== targetLower) return;
      const badge = document.createElement('a');
      badge.className = `profile-badge ${TITLE_CLASS}`;
      badge.href = '/members/titled-players';
      badge.target = '_blank';
      const icon = document.createElement('div');
      icon.className = 'badges-icon-square badges-titled';
      icon.innerHTML = '<span class="cc-icon-glyph cc-icon-size-24 badges-icon"><svg aria-hidden="true" data-glyph="game-crown-2" viewBox="0 0 24 24" height="24" width="24" xmlns="http://www.w3.org/2000/svg" style="fill:currentColor"><path d="M19 20V22H5.00002V20H19ZM1.27002 6.57001C2.30002 5.54001 3.47002 5.54001 4.17002 6.24001C4.74002 6.81001 4.84002 7.64001 4.17002 8.64001L7.24002 10.91C7.31002 10.98 7.47002 10.94 7.54002 10.84L10.37 6.84001H9.87002C8.77002 6.84001 8.30002 6.07001 8.30002 5.34001C8.30002 4.54001 9.00002 3.84001 9.87002 3.84001H10.5V3.11001C10.5 2.21001 11.2 1.51001 12 1.51001C12.83 1.51001 13.5 2.21001 13.5 3.11001V3.84001H14.13C15 3.84001 15.7 4.54001 15.7 5.34001C15.7 6.07001 15.23 6.84001 14.13 6.84001H13.63L16.5 10.84C16.57 10.94 16.67 10.97 16.77 10.91L19.8 8.68001C19.13 7.68001 19.23 6.81001 19.83 6.25001C20.53 5.52001 21.7 5.55001 22.73 6.58001L19 18.01H5.00002L1.27002 6.57001Z"></path></svg></span>';
      const about = document.createElement('div');
      about.className = 'badges-about';
      about.innerHTML = `<span class="cc-heading-xx-small badges-name">Titled Player</span> <span class="cc-text-small badges-extra">${TITLE_FULL_NAMES[titleText] || titleText}</span>`;
      badge.appendChild(icon);
      badge.appendChild(about);
      const streakBadge = badgesSection.querySelector('.profile-badge:has(.streak-badge-about)');
      if (streakBadge) streakBadge.insertAdjacentElement('afterend', badge);
      else badgesSection.insertBefore(badge, badgesSection.firstChild);
    }

    function injectSidebarTitle() {
      const anchor = document.querySelector('a[data-user-activity-key="profile"]');
      if (!anchor) return;
      if (anchor.querySelector(`.${TITLE_CLASS}`)) return;
      const name = anchor.querySelector<HTMLElement>('.sidebar-link-text');
      if (!name) return;
      // The anchor is a CSS grid — inserting the badge between cells lands it
      // in a 0px column. Put it inside the name element so it flows inline.
      const title = document.createElement('span');
      title.className = `cc-user-title-component cc-text-x-small-bold ${TITLE_CLASS}`;
      title.textContent = titleText;
      title.style.marginRight = '4px';
      name.insertBefore(title, name.firstChild);
    }

    function injectMockTitle() {
      if (!titleActive) return;
      if (!/(^|\.)chess\.com$/.test(location.hostname)) return;
      const user = getChessComUsername();
      if (!user) return;
      const lower = user.toLowerCase();
      injectGameTitle(lower);
      injectProfileTitle(lower);
      injectProfileBadge(lower);
      injectSidebarTitle();
    }

    function scheduleTitleInject() {
      if (!titleActive) return;
      if (titleDebounce) clearTimeout(titleDebounce);
      titleDebounce = setTimeout(injectMockTitle, 100);
    }

    if (titleActive) scheduleTitleInject();

    const titleObserver = new MutationObserver(() => {
      if (titleActive) scheduleTitleInject();
    });
    titleObserver.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('message', (e) => {
      if (e.data?.type !== 'chessr:setTitle') return;
      const enabled = !!e.data.enabled;
      const type = typeof e.data.type_ === 'string' && e.data.type_ ? e.data.type_ : titleText;
      const typeChanged = type !== titleText;
      titleText = type;
      try {
        localStorage.setItem('chessr-title-type', titleText);
        localStorage.setItem('chessr-title', enabled ? 'true' : 'false');
      } catch {}
      if (enabled) {
        titleActive = true;
        if (typeChanged) removeMockTitles();
        injectMockTitle();
      } else {
        titleActive = false;
        if (titleDebounce) { clearTimeout(titleDebounce); titleDebounce = null; }
        removeMockTitles();
      }
    });

    // ========== Auto Move handlers ==========

    function findLegalMove(game: any, fromSq: string, toSq: string, promo?: string): any {
      const legal = game.getLegalMoves?.() || [];
      for (const m of legal) {
        // Chess.com move objects expose .from/.to as squares — match by notation
        if (m.from === fromSq && m.to === toSq) {
          if (promo) {
            if (m.promotion === promo || m.san?.endsWith(`=${promo.toUpperCase()}`)) return m;
          } else {
            return m;
          }
        }
      }
      return null;
    }

    function doMove(game: any, moveObj: any): void {
      try {
        game.move({ ...moveObj, userGenerated: true, animate: false });
      } catch (err) {
        console.warn('[Chessr pageContext] move failed', err);
      }
    }

    window.addEventListener('message', (e) => {
      const data = e.data;
      if (typeof data?.type !== 'string') return;

      // Execute a move (hotkey or auto-play), with optional humanization
      if (data.type === 'chessr:executeMove') {
        const game = currentGame;
        if (!game) return;
        const uci: string = data.move;
        if (!uci || uci.length < 4) return;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promo = uci[4];

        const moveObj = findLegalMove(game, from, to, promo);
        if (!moveObj) {
          console.warn('[Chessr pageContext] no legal move match', uci);
          return;
        }

        const h = data.humanize as { pickDelay: number; selectDelay: number; moveDelay: number } | null;
        if (h) {
          try { game.emit('PieceClicked', { square: from, piece: moveObj.piece }); } catch {}
          setTimeout(() => {
            try { game.emit('PieceSelected', { square: from, piece: moveObj.piece }); } catch {}
            setTimeout(() => {
              setTimeout(() => { doMove(game, moveObj); }, h.moveDelay);
            }, h.selectDelay);
          }, h.pickDelay);
        } else {
          try { game.emit('PieceClicked', { square: from, piece: moveObj.piece }); } catch {}
          try { game.emit('PieceSelected', { square: from, piece: moveObj.piece }); } catch {}
          doMove(game, moveObj);
        }
      }

      // Queue a premove
      if (data.type === 'chessr:executePremove') {
        const game = currentGame;
        if (!game?.premoves) return;
        const uci: string = data.move;
        if (!uci || uci.length < 4) return;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promo = uci[4];
        try {
          game.premoves.move({ from, to, promotion: promo }, null);
        } catch (err) {
          console.warn('[Chessr pageContext] premove failed', err);
        }
      }

      // Cancel all queued premoves
      if (data.type === 'chessr:cancelPremoves') {
        const game = currentGame;
        if (!game?.premoves) return;
        try { game.premoves.cancel(); } catch {}
      }

      // Auto-rematch: build a seek from the current game's parameters and POST.
      // Only supported on online games (not bot — handled upstream in content script).
      if (data.type === 'chessr:rematch') {
        const game = currentGame;
        const tc = game?.timeControl?.get?.();
        const h = game?.getHeaders?.() || {};
        if (!tc) {
          console.warn('[Chessr pageContext] rematch: no timeControl available');
          return;
        }
        const baseS = Math.round((tc.baseTime || 0) / 1000);
        const incS = Math.round((tc.increment || 0) / 1000);
        const rated = !!(h.WhiteElo || h.BlackElo);
        const seek = {
          capabilities: rated ? ['rated'] : [],
          rated,
          gameType: game?.getVariant?.() || 'chess',
          timeControl: { base: `PT${baseS}S`, increment: `PT${incS}S` },
          ratingRange: { upper: null, lower: null },
        };
        fetch('https://www.chess.com/service/matcher/seeks/chess', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(seek),
        })
          .then((r) => console.log('[Chessr pageContext] rematch seek status', r.status))
          .catch((err) => console.warn('[Chessr pageContext] rematch seek failed', err));
      }
    });

    // Detect player and opponent ratings from DOM
    function detectRatings() {
      const bottom = document.querySelector('#board-layout-player-bottom');
      const top = document.querySelector('#board-layout-player-top');
      const playerRatingEl = bottom?.querySelector('[data-cy="user-tagline-rating"]');
      const opponentRatingEl = top?.querySelector('[data-cy="user-tagline-rating"]');
      const playerRating = playerRatingEl?.textContent?.trim().replace(/[()]/g, '');
      const opponentRating = opponentRatingEl?.textContent?.trim().replace(/[()]/g, '');
      window.postMessage({
        type: 'chessr:ratings',
        playerRating: playerRating ? parseInt(playerRating, 10) : null,
        opponentRating: opponentRating ? parseInt(opponentRating, 10) : null,
      }, '*');
    }

    // Respond to state requests from content script
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'chessr:requestState' && currentGame) {
        const mode = currentGame.getMode();
        const gameResult = currentGame.getResult?.() || '*';
        window.postMessage({
          type: 'chessr:mode',
          name: mode?.name || null,
          playingAs: currentGame.getPlayingAs(),
          fen: currentGame.getFEN(),
          gameOver: currentGame.getPositionInfo()?.gameOver || false,
          turn: currentGame.getTurn(),
          result: gameResult,
        }, '*');
      }
    });

    const observer = new MutationObserver(() => {
      if (getBoard()) watchBoard();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    if (getBoard()) watchBoard();

    // SPA nav can swap the internal game reference without triggering DOM
    // mutations — poll to catch those switches.
    setInterval(() => { if (getBoard()) watchBoard(); }, 500);

    // URL change via history API → force an immediate re-check.
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args: any[]) {
      const r = origPush.apply(this, args as any);
      queueMicrotask(() => { if (getBoard()) watchBoard(); });
      return r;
    };
    history.replaceState = function (...args: any[]) {
      const r = origReplace.apply(this, args as any);
      queueMicrotask(() => { if (getBoard()) watchBoard(); });
      return r;
    };
    window.addEventListener('popstate', () => { if (getBoard()) watchBoard(); });
  },
});
