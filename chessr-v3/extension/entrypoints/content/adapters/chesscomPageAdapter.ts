/**
 * chess.com page-context adapter.
 *
 * Patches the `wc-chess-board` web component's `game` property to:
 *   - intercept `game.move(...)` and emit `chessr:move`
 *   - subscribe to `ResetGame`, `ModeChanged`, `UpdatePGNHeaders` events
 *   - track SPA navigation by re-checking the board on history changes
 *
 * Auto-move replays the chess.com player UX (PieceClicked → PieceSelected →
 * game.move) so timing analytics see a humanlike sequence.
 */

import type {
  ChessrPostMessage,
  GameEnd,
  HumanizeTiming,
  PageContextAdapter,
} from './PageContextAdapter';

type Emit = (msg: ChessrPostMessage) => void;

function getBoard(): any {
  return document.querySelector('wc-chess-board');
}

function getGameEndInfo(game: any): GameEnd | null {
  const info = game.getPositionInfo();
  if (!info?.gameOver) return null;
  return {
    checkmate: !!info.checkmate,
    stalemate: !!info.stalemate,
    draw: !!info.draw,
    threefold: !!info.threefold,
    insufficient: !!info.insufficient,
    fiftyMoveRule: !!info.fiftyMoveRule,
  };
}

function readRatings(): { playerRating: number | null; opponentRating: number | null } {
  const bottom = document.querySelector('#board-layout-player-bottom');
  const top = document.querySelector('#board-layout-player-top');
  const playerRatingEl = bottom?.querySelector('[data-cy="user-tagline-rating"]');
  const opponentRatingEl = top?.querySelector('[data-cy="user-tagline-rating"]');
  const parse = (el: Element | null | undefined): number | null => {
    const txt = el?.textContent?.trim().replace(/[()]/g, '');
    if (!txt) return null;
    const n = parseInt(txt, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    playerRating: parse(playerRatingEl),
    opponentRating: parse(opponentRatingEl),
  };
}

/** Extract the list of moves already played in the current chess.com game,
 *  in UCI notation. chess.com's wc-chess-board exposes several methods:
 *  getCurrentFullLine, getLine, getRawLines, getPGN. We probe in order of
 *  preference. Returns [] on miss (fresh game or unknown API).
 *
 *  Used for live continuation games: when chessr loads on a /play/computer
 *  game already in progress, we seed moveHistoryUci with the prior moves so
 *  torch's fetch_analysis (which requires startpos-rooted history) can run. */
function extractInitialMoves(game: any): string[] {
  if (!game) return [];

  // Each of these returns an array of node objects { move: { from, to, promotion } }
  // or similar. Probe in order of specificity.
  const candidates: any[] = [];
  try { if (typeof game.getCurrentFullLine === 'function') candidates.push(game.getCurrentFullLine()); } catch {}
  try { if (typeof game.getLine === 'function') candidates.push(game.getLine()); } catch {}
  try { if (typeof game.getRawLines === 'function') candidates.push(game.getRawLines()); } catch {}

  for (const list of candidates) {
    const flat = Array.isArray(list) ? list : Array.isArray(list?.[0]) ? list[0] : null;
    if (!flat || flat.length === 0) continue;
    const ucis: string[] = [];
    for (const node of flat) {
      if (!node || typeof node !== 'object') continue;
      const m = node.move ?? node;
      if (!m) continue;
      const from = m.from;
      const to = m.to;
      const promotion = m.promotion ?? '';
      if (typeof from === 'string' && typeof to === 'string' && from.length === 2 && to.length === 2) {
        ucis.push(`${from}${to}${promotion}`);
      }
    }
    if (ucis.length > 0) {
      console.log('[Chessr chesscom] extracted', ucis.length, 'initial moves via game API');
      return ucis;
    }
  }

  // Fallback: parse the PGN. chess.com exposes `getPGN()` returning the
  // SAN move list — we parse it with chess.js (loaded by chessr) to get
  // UCI moves. PGN includes headers and tags so we strip those first.
  try {
    const pgn = typeof game.getPGN === 'function' ? game.getPGN() : (game.pgn ?? null);
    if (typeof pgn === 'string' && pgn.length > 0) {
      // chess.js is bundled with chessr; we run in page-world here so we
      // can't import it directly. Just emit the SAN list and let the
      // chessr content-script side parse it. We attach a `pgn` field on
      // the message for the receiver to handle.
      console.log('[Chessr chesscom] falling back to PGN parsing,', pgn.length, 'chars');
      // Encode as a synthetic uci pseudo-list so the receiver knows to
      // parse this as PGN — prefix with "pgn:" sentinel.
      return ['pgn:' + pgn];
    }
  } catch {}

  return [];
}

function findLegalMove(game: any, fromSq: string, toSq: string, promo?: string): any {
  const legal = game.getLegalMoves?.() || [];
  for (const m of legal) {
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
    console.warn('[Chessr chesscom] move failed', err);
  }
}

export class ChesscomPageAdapter implements PageContextAdapter {
  private board: any = null;
  private currentGame: any = null;
  private patched = false;
  private lastMode: string | null = null;
  private observer: MutationObserver | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private origPushState: typeof history.pushState | null = null;
  private origReplaceState: typeof history.replaceState | null = null;
  private onPopState: (() => void) | null = null;
  // Ratings detection state. Online games render the player cards AFTER
  // matchmaking → first detection at +500ms often misses them. Poll until
  // both ratings resolve OR the deadline expires. Reset on new game so a
  // fresh opponent gets re-detected.
  private ratingsPoll: ReturnType<typeof setInterval> | null = null;
  private ratingsLast: { playerRating: number | null; opponentRating: number | null } = {
    playerRating: null,
    opponentRating: null,
  };
  private emit: Emit | null = null;

  matches(host: string): boolean {
    return /(^|\.)chess\.com$/.test(host);
  }

  install(emit: Emit): () => void {
    this.emit = emit;

    const watchBoard = () => {
      const newBoard = getBoard();
      if (!newBoard) return;

      const isNewBoard = newBoard !== this.board;
      if (isNewBoard) {
        this.board = newBoard;
        this.patched = false;
      }

      const rawGame = isNewBoard ? this.board.game : this.getRawGame(this.board, emit);
      if (rawGame && rawGame !== this.currentGame) {
        const isFirst = this.currentGame === null;
        this.currentGame = rawGame;
        this.patched = false;
        if (!isFirst) emit({ type: 'chessr:newGame' });
        this.patchGame(rawGame, emit);
      }

      if (isNewBoard) {
        Object.defineProperty(this.board, 'game', {
          get: () => this.currentGame,
          set: (newGame: any) => {
            this.currentGame = newGame;
            this.patched = false;
            if (newGame) {
              emit({ type: 'chessr:newGame' });
              this.patchGame(newGame, emit);
            }
          },
          configurable: true,
        });
      }
    };

    this.observer = new MutationObserver(() => {
      if (getBoard()) watchBoard();
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });

    if (getBoard()) watchBoard();

    // SPA nav can swap the internal game reference without DOM mutations.
    this.pollInterval = setInterval(() => {
      if (getBoard()) watchBoard();
    }, 500);

    // history API → re-check immediately on URL change
    this.origPushState = history.pushState;
    this.origReplaceState = history.replaceState;
    history.pushState = function (this: History, ...args: any[]) {
      const r = (this as any).__chessrOrigPushState
        ? (this as any).__chessrOrigPushState.apply(this, args)
        : (history as any).pushState.apply(this, args);
      queueMicrotask(() => { if (getBoard()) watchBoard(); });
      return r;
    } as any;
    (history as any).__chessrOrigPushState = this.origPushState;
    history.replaceState = function (this: History, ...args: any[]) {
      const r = (this as any).__chessrOrigReplaceState
        ? (this as any).__chessrOrigReplaceState.apply(this, args)
        : (history as any).replaceState.apply(this, args);
      queueMicrotask(() => { if (getBoard()) watchBoard(); });
      return r;
    } as any;
    (history as any).__chessrOrigReplaceState = this.origReplaceState;
    this.onPopState = () => { if (getBoard()) watchBoard(); };
    window.addEventListener('popstate', this.onPopState);

    return () => this.dispose();
  }

  private dispose() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
    if (this.ratingsPoll) clearInterval(this.ratingsPoll);
    this.ratingsPoll = null;
    if (this.origPushState) history.pushState = this.origPushState;
    if (this.origReplaceState) history.replaceState = this.origReplaceState;
    if (this.onPopState) window.removeEventListener('popstate', this.onPopState);
    this.emit = null;
  }

  /** Poll the player cards every 500ms until both ratings resolve OR a 15s
   *  deadline expires. Re-emit on every change so partial detections (e.g.
   *  player loaded but opponent still in matchmaking) reach the engine
   *  store, then refine when the second card lands. Reset state to start
   *  a fresh detection — call this on adapter install AND on `chessr:newGame`. */
  private startRatingsPoll(emit: Emit) {
    if (this.ratingsPoll) clearInterval(this.ratingsPoll);
    this.ratingsLast = { playerRating: null, opponentRating: null };
    let elapsed = 0;
    const tick = () => {
      const r = readRatings();
      const changed = r.playerRating !== this.ratingsLast.playerRating
                   || r.opponentRating !== this.ratingsLast.opponentRating;
      if (changed && (r.playerRating !== null || r.opponentRating !== null)) {
        this.ratingsLast = r;
        emit({ type: 'chessr:ratings', playerRating: r.playerRating, opponentRating: r.opponentRating });
      }
      // Stop once both resolve or we hit the deadline.
      if ((r.playerRating !== null && r.opponentRating !== null) || elapsed >= 15000) {
        if (this.ratingsPoll) { clearInterval(this.ratingsPoll); this.ratingsPoll = null; }
      }
    };
    tick(); // immediate first read
    this.ratingsPoll = setInterval(() => {
      elapsed += 500;
      tick();
    }, 500);
  }

  requestState(): void {
    if (!this.emit || !this.currentGame) return;
    const mode = this.currentGame.getMode();
    const gameResult = this.currentGame.getResult?.() || '*';
    this.emit({
      type: 'chessr:mode',
      name: mode?.name || null,
      playingAs: this.currentGame.getPlayingAs(),
      fen: this.currentGame.getFEN(),
      gameOver: this.currentGame.getPositionInfo()?.gameOver || false,
      turn: this.currentGame.getTurn(),
      result: gameResult,
    });
  }

  /** Read game from board bypassing our property override. */
  private getRawGame(b: any, emit: Emit): any {
    const desc = Object.getOwnPropertyDescriptor(b, 'game');
    if (!desc?.get) return b.game;
    delete b.game;
    const real = b.game;
    Object.defineProperty(b, 'game', {
      get: () => this.currentGame,
      set: (newGame: any) => {
        this.currentGame = newGame;
        this.patched = false;
        if (newGame) {
          emit({ type: 'chessr:newGame' });
          this.patchGame(newGame, emit);
        }
      },
      configurable: true,
    });
    return real;
  }

  private patchGame(game: any, emit: Emit) {
    if (!game || this.patched) return;
    this.patched = true;
    this.lastMode = game.getMode()?.name || null;

    // If chessr loaded mid-game (continuation /play/computer, observed
    // game, etc.), pull the moves already played and seed moveHistoryUci
    // so torch fetch_analysis can run from startpos.
    const seedMoves = extractInitialMoves(game);
    if (seedMoves.length > 0) {
      console.log('[Chessr chesscom] seeding initial moves:', seedMoves.length);
      emit({ type: 'chessr:initialMoves', moves: seedMoves });
    }

    const originalMove = game.move.bind(game);
    game.move = (moveData: any) => {
      const result = originalMove(moveData);
      emit({
        type: 'chessr:move',
        fen: game.getFEN(),
        gameOver: game.getPositionInfo()?.gameOver || false,
        gameEnd: getGameEndInfo(game),
        turn: game.getTurn(),
      });
      return result;
    };

    game.on('ResetGame', () => {
      console.log('[Chessr chesscom] ResetGame event');
      emit({ type: 'chessr:newGame' });
      // Re-detect opponent ratings — a rematch / new opponent renders a
      // fresh card and the previous opponent rating is stale.
      this.startRatingsPoll(emit);
      this.lastMode = game.getMode()?.name || null;
      emit({
        type: 'chessr:mode',
        name: this.lastMode,
        playingAs: game.getPlayingAs(),
      });
      emit({
        type: 'chessr:move',
        fen: game.getFEN(),
        gameOver: game.getPositionInfo()?.gameOver || false,
        gameEnd: getGameEndInfo(game),
        turn: game.getTurn(),
      });
    });

    game.on('ModeChanged', (event: any) => {
      const newMode = event.data;
      const wasPlaying = this.lastMode === 'playing';
      const nowPlaying = newMode === 'playing';
      this.lastMode = newMode;
      console.log('[Chessr chesscom] ModeChanged', newMode, wasPlaying ? '(was playing)' : '');

      if (nowPlaying && !wasPlaying) {
        emit({ type: 'chessr:newGame' });
        const refreshState = () => {
          emit({
            type: 'chessr:mode',
            name: 'playing',
            playingAs: game.getPlayingAs(),
            fen: game.getFEN(),
            gameOver: false,
            gameEnd: null,
            turn: game.getTurn(),
            result: '*',
          });
        };
        refreshState();
        setTimeout(refreshState, 150);
        setTimeout(refreshState, 500);
        return;
      }

      const posGameOver = game.getPositionInfo()?.gameOver || false;
      const gameResult = game.getResult?.() || '*';
      const isGameOver = posGameOver || (wasPlaying && !nowPlaying) || (gameResult !== '*');

      emit({
        type: 'chessr:mode',
        name: newMode,
        playingAs: game.getPlayingAs(),
        fen: game.getFEN(),
        gameOver: isGameOver,
        gameEnd: getGameEndInfo(game),
        turn: game.getTurn(),
        result: gameResult,
      });
    });

    game.on('UpdatePGNHeaders', (event: any) => {
      const headers = event.data;
      if (headers?.Result && headers.Result !== '*') {
        console.log('[Chessr chesscom] Game result from PGN:', headers.Result);
        emit({
          type: 'chessr:gameOver',
          result: headers.Result,
          fen: game.getFEN(),
          turn: game.getTurn(),
          gameEnd: getGameEndInfo(game),
        });
      }
    });

    // Initial state — emitted multiple times to catch SPA-nav races.
    const sendInitialState = () => {
      const m = game.getMode();
      const modeName = m?.name || null;
      const playing = modeName === 'playing';
      emit({
        type: 'chessr:mode',
        name: modeName,
        playingAs: game.getPlayingAs(),
        fen: game.getFEN(),
        gameOver: playing ? false : (game.getPositionInfo()?.gameOver || false),
        turn: game.getTurn(),
        result: playing ? '*' : (game.getResult?.() || '*'),
      });
    };
    sendInitialState();
    setTimeout(sendInitialState, 150);
    setTimeout(sendInitialState, 500);
    setTimeout(sendInitialState, 1500);

    this.startRatingsPoll(emit);
  }

  async executeMove(uci: string, humanize?: HumanizeTiming): Promise<boolean> {
    const game = this.currentGame;
    if (!game || !uci || uci.length < 4) return false;

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci[4];

    const moveObj = findLegalMove(game, from, to, promo);
    if (!moveObj) {
      console.warn('[Chessr chesscom] no legal move match', uci);
      return false;
    }

    if (humanize) {
      try { game.emit('PieceClicked', { square: from, piece: moveObj.piece }); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, humanize.pickDelay));
      try { game.emit('PieceSelected', { square: from, piece: moveObj.piece }); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, humanize.selectDelay));
      await new Promise((r) => setTimeout(r, humanize.moveDelay));
      doMove(game, moveObj);
    } else {
      try { game.emit('PieceClicked', { square: from, piece: moveObj.piece }); } catch { /* ignore */ }
      try { game.emit('PieceSelected', { square: from, piece: moveObj.piece }); } catch { /* ignore */ }
      doMove(game, moveObj);
    }
    return true;
  }

  executePremove(uci: string): boolean {
    const game = this.currentGame;
    if (!game?.premoves || !uci || uci.length < 4) return false;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci[4];
    try {
      game.premoves.move({ from, to, promotion: promo }, null);
      return true;
    } catch (err) {
      console.warn('[Chessr chesscom] premove failed', err);
      return false;
    }
  }

  cancelPremoves(): void {
    const game = this.currentGame;
    if (!game?.premoves) return;
    try { game.premoves.cancel(); } catch { /* ignore */ }
  }

  requestRematch(): boolean {
    const game = this.currentGame;
    const tc = game?.timeControl?.get?.();
    const h = game?.getHeaders?.() || {};
    if (!tc) {
      console.warn('[Chessr chesscom] rematch: no timeControl available');
      return false;
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
      .then((r) => console.log('[Chessr chesscom] rematch seek status', r.status))
      .catch((err) => console.warn('[Chessr chesscom] rematch seek failed', err));
    return true;
  }
}
