/**
 * Lichess page-context adapter.
 *
 * Lichess closed its public client API: `window.lichess.round` /
 * `socket.send` / internal socket events are inaccessible. The trick we use
 * (borrowed from the ChessHv3 / RedEric extension): monkey-patch
 * `site.sound.move` (or `lichess.sound.move`). Lichess calls this on every
 * ply to play the move sound, but the payload differs per surface:
 *
 *   - round / puzzle: `{ fen, ply, status: { name, ... }, ... }`
 *   - storm / racer:  `{ san, uci }` only (lib/puz/current.ts#playSound)
 *
 * Round/puzzle path: synthesise a full FEN from the board portion (or pass
 * through the full puzzle FEN) and use the ply parity to derive turn.
 * Storm/racer path: scrape the FEN from chessground DOM (`<piece>.cgKey`),
 * since the payload doesn't carry it. After every storm/racer sound.move,
 * the board has both the user's move and the engine's reply applied, and
 * the side-to-move equals the user's orientation.
 *
 * Auto-move: synthesise mousedown/mouseup on the cg-board square centres.
 * chessground reads pointer events at document level; this lands as a real
 * user move and goes through Lichess's move-validation pipeline (server WS
 * send included). No premove API — chessground queues a regular move during
 * opponent's turn as a premove automatically.
 *
 * Rematch: DOM click on `.rematch button[data-icon=']']` after game over.
 *
 * Logs are prefixed with `[Chessr lichess]` so you can filter cleanly.
 */

import type {
  ChessrPostMessage,
  Color,
  GameEnd,
  HumanizeTiming,
  PageContextAdapter,
} from './PageContextAdapter';

type Emit = (msg: ChessrPostMessage) => void;

interface LichessSoundArg {
  fen?: string;
  ply?: number;
  status?: { id?: number; name?: string };
  winner?: Color;
  uci?: string;
}

interface LichessSoundCarrier {
  sound?: {
    move?: ((x: LichessSoundArg) => unknown) & { __chessrPatched?: boolean };
  };
}

interface LichessGlobal {
  events?: { on: (name: string, cb: (...args: unknown[]) => void) => void };
  socket?: { events?: { on: (name: string, cb: (...args: unknown[]) => void) => void } };
  puzzle?: { playUci?: (uci: string) => void };
}

const LOG = '[Chessr lichess]';

/** Placeholder castling rights — see file header. */
const PLACEHOLDER_CASTLING = '-';
const PLACEHOLDER_EP = '-';
const PLACEHOLDER_HALFMOVE = '0';

function deriveGameEnd(statusName: string | undefined): GameEnd | null {
  if (!statusName) return null;
  return {
    checkmate: statusName === 'mate',
    stalemate: statusName === 'stalemate',
    draw: statusName === 'draw',
    threefold: statusName === 'threefoldRepetition',
    insufficient: statusName === 'insufficientMaterial',
    fiftyMoveRule: false,
  };
}

function isGameOverStatus(name: string | undefined): boolean {
  if (!name) return false;
  return ['mate', 'stalemate', 'draw', 'resign', 'timeout', 'outoftime',
          'cheat', 'noStart', 'unknownFinish', 'variantEnd', 'aborted',
          'threefoldRepetition', 'insufficientMaterial'].includes(name);
}

function statusToResult(name: string | undefined, winner: Color | undefined): string {
  if (!isGameOverStatus(name)) return '*';
  if (winner === 'white') return '1-0';
  if (winner === 'black') return '0-1';
  return '1/2-1/2';
}

/** Lichess passes `x.fen` differently per context:
 *    - live games:  board portion only ("rnbqkbnr/...")
 *    - puzzles:     full FEN already   ("rnbqkbnr/... w KQkq - 0 1")
 *  Detect by field count and pass through if already complete. */
function buildFullFen(rawFen: string, ply: number): string {
  const trimmed = rawFen.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 6) {
    // Full FEN — keep first 6 fields, drop any duplicates.
    return parts.slice(0, 6).join(' ');
  }
  if (parts.length === 1) {
    // Board-only — synthesize the rest with placeholder castling/ep.
    const side = ply % 2 === 0 ? 'w' : 'b';
    const fullmove = Math.floor(ply / 2) + 1;
    return `${parts[0]} ${side} ${PLACEHOLDER_CASTLING} ${PLACEHOLDER_EP} ${PLACEHOLDER_HALFMOVE} ${fullmove}`;
  }
  // Partial FEN (2-5 fields) — pad with placeholders.
  const side = parts[1] ?? (ply % 2 === 0 ? 'w' : 'b');
  const castling = parts[2] ?? PLACEHOLDER_CASTLING;
  const ep = parts[3] ?? PLACEHOLDER_EP;
  const halfmove = parts[4] ?? PLACEHOLDER_HALFMOVE;
  const fullmove = parts[5] ?? String(Math.floor(ply / 2) + 1);
  return `${parts[0]} ${side} ${castling} ${ep} ${halfmove} ${fullmove}`;
}

/** Find the orientation from the cg-wrap class. White if `.orientation-white` (default), black otherwise. */
function readOrientation(): Color {
  const wrap = document.querySelector('.cg-wrap');
  return wrap?.classList.contains('orientation-black') ? 'black' : 'white';
}

/** Reconstruct the FEN board portion from chessground's `<piece>` elements.
 *  Each piece has `cgKey` (the algebraic square) and class `"<color> <type>"`.
 *  Returns just the board portion (no side/castling/etc). */
function readBoardFenFromDom(): string | null {
  const wrap = document.querySelector('.cg-wrap');
  if (!wrap) return null;
  const map: Record<string, string> = {
    pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
  };
  const board: Record<string, string> = {};
  const pieces = wrap.querySelectorAll('piece');
  if (!pieces.length) return null;
  for (const p of pieces) {
    const key = (p as unknown as { cgKey?: string }).cgKey;
    if (!key || key.length !== 2) continue;
    const cls = (p as Element).className.split(/\s+/);
    const color = cls.includes('white') ? 'w' : cls.includes('black') ? 'b' : null;
    const typeName = cls.find((c) => c in map);
    if (!color || !typeName) continue;
    const ch = map[typeName];
    board[key] = color === 'w' ? ch.toUpperCase() : ch;
  }
  const ranks: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const sq = String.fromCharCode(97 + f) + r;
      const piece = board[sq];
      if (piece) {
        if (empty) { row += empty; empty = 0; }
        row += piece;
      } else {
        empty++;
      }
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  const result = ranks.join('/');
  // Sanity: must contain both kings to be a valid position.
  if (!result.includes('K') || !result.includes('k')) return null;
  return result;
}

/** Read DOM rating elements. Lichess marks them with `<rating>` tags inside `.ruser-top` / `.ruser-bottom`. */
function readRatings(): { playerRating: number | null; opponentRating: number | null } {
  const parse = (el: Element | null) => {
    const txt = el?.textContent?.trim();
    if (!txt) return null;
    const m = txt.match(/(\d{3,4})/);
    return m ? parseInt(m[1], 10) : null;
  };
  return {
    playerRating: parse(document.querySelector('.ruser-bottom rating')),
    opponentRating: parse(document.querySelector('.ruser-top rating')),
  };
}

/** Locate the carrier holding sound.move. Lichess split it: `window.site` (current) and `window.lichess` (legacy alias). */
function getSoundCarrier(): LichessSoundCarrier | null {
  const w = window as unknown as { site?: LichessSoundCarrier; lichess?: LichessSoundCarrier };
  return w.site?.sound ? w.site : (w.lichess?.sound ? w.lichess : null);
}

function getEvents(): LichessGlobal['events'] | undefined {
  const w = window as unknown as { lichess?: LichessGlobal; site?: LichessGlobal };
  return w.lichess?.events ?? w.site?.events;
}

function getSocket(): LichessGlobal['socket'] | undefined {
  const w = window as unknown as { lichess?: LichessGlobal; site?: LichessGlobal };
  return w.lichess?.socket ?? w.site?.socket;
}

function getPuzzle(): LichessGlobal['puzzle'] | undefined {
  const w = window as unknown as { lichess?: LichessGlobal; site?: LichessGlobal };
  return w.lichess?.puzzle ?? w.site?.puzzle;
}

/** Storm and Racer don't expose their controllers on window. We detect them
 *  purely by URL pattern. Both surfaces share the storm-shaped sound.move
 *  payload (`{san, uci}` only — see lib/puz/current.ts#playSound). */
function isStormPage(): boolean {
  return /^\/storm(\/|$)/.test(location.pathname);
}

function isRacerPage(): boolean {
  return /^\/racer(\/|$)/.test(location.pathname);
}

function isPuzCtxPage(): boolean {
  return isStormPage() || isRacerPage();
}

/** Square-centre coords in viewport pixels for a given algebraic square. */
function squareCenter(boardEl: HTMLElement, square: string, orientation: Color): { x: number; y: number } | null {
  if (square.length < 2) return null;
  const rect = boardEl.getBoundingClientRect();
  const size = rect.width / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: rect.left + col * size + size / 2, y: rect.top + row * size + size / 2 };
}

function dispatchPointer(target: HTMLElement, type: 'pointerdown' | 'pointerup' | 'mousedown' | 'mouseup', x: number, y: number) {
  const opts: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type.endsWith('down') ? 1 : 0,
    pointerId: 1,
    pointerType: 'mouse',
  };
  // Pointer events are what chessground listens for primarily.
  if (type.startsWith('pointer')) {
    target.dispatchEvent(new PointerEvent(type, opts));
  } else {
    target.dispatchEvent(new MouseEvent(type, opts as MouseEventInit));
  }
}

export class LichessPageAdapter implements PageContextAdapter {
  private emit: Emit | null = null;
  private hookInstalled = false;
  private bootPoll: ReturnType<typeof setInterval> | null = null;
  private urlPoll: ReturnType<typeof setInterval> | null = null;
  private observer: MutationObserver | null = null;
  private ratingsTimer: ReturnType<typeof setTimeout> | null = null;
  private ratingsSent = false;
  private lastUrl = '';

  // Last state captured from sound.move — kept for `requestState` resync.
  private lastFen: string | null = null;
  private lastPly = 0;
  private lastGameOver = false;
  private lastResult = '*';
  private lastGameEnd: GameEnd | null = null;

  // Puzzle wrong-move detection. Lichess silently reverts the board after a
  // wrong puzzle attempt — no `sound.move` fires on the revert. We poll the
  // DOM shortly after we just played, and if the position differs from
  // `lastFen` we re-emit so suggestions refresh.
  private postMoveCheckTimer: ReturnType<typeof setTimeout> | null = null;

  matches(host: string): boolean {
    return /(^|\.)lichess\.org$/.test(host);
  }

  install(emit: Emit): () => void {
    this.emit = emit;
    this.lastUrl = location.href;
    console.log(`${LOG} install on`, location.href);

    (window as any).__chessrLichess = () => ({
      hookInstalled: this.hookInstalled,
      lastFen: this.lastFen,
      lastPly: this.lastPly,
      lastGameOver: this.lastGameOver,
      hasSoundCarrier: !!getSoundCarrier()?.sound?.move,
      orientation: readOrientation(),
    });

    // Monkey-patch + endData subscription as soon as the carrier exists.
    let elapsed = 0;
    this.bootPoll = setInterval(() => {
      elapsed += 100;
      if (this.tryInstallHook()) {
        if (this.bootPoll) { clearInterval(this.bootPoll); this.bootPoll = null; }
      } else if (elapsed >= 5000) {
        if (this.bootPoll) { clearInterval(this.bootPoll); this.bootPoll = null; }
        console.warn(`${LOG} sound.move carrier not found after ${elapsed}ms — adapter idle`);
      }
    }, 100);

    this.urlPoll = setInterval(() => {
      if (location.href !== this.lastUrl) {
        const prev = this.lastUrl;
        this.lastUrl = location.href;
        console.log(`${LOG} SPA nav ${prev} → ${location.href}`);
        this.onUrlChange();
      }
    }, 500);

    return () => this.dispose();
  }

  /** Returns true once the hook is in place. Idempotent. */
  private tryInstallHook(): boolean {
    if (this.hookInstalled) return true;

    const carrier = getSoundCarrier();
    const move = carrier?.sound?.move;
    if (!move) return false;
    if (move.__chessrPatched) {
      this.hookInstalled = true;
      return true;
    }

    const original = move;
    const patched = ((x: LichessSoundArg) => {
      try { this.onSoundMove(x); } catch (err) { console.warn(`${LOG} hook error`, err); }
      return (original as Function).call(carrier!.sound, x);
    }) as typeof original & { __chessrPatched?: boolean };
    patched.__chessrPatched = true;
    carrier!.sound!.move = patched;
    this.hookInstalled = true;
    console.log(`${LOG} sound.move patched`);

    // Subscribe to the public socket event for definitive game-over notice.
    const socket = getSocket();
    socket?.events?.on('endData', (data: unknown) => {
      console.log(`${LOG} 'endData' received`, data);
      this.onEndData(data as { winner?: Color; status?: { id?: number; name?: string } });
    });

    // Initial mode push so the content script gets out of "idle" state even
    // before the first move (e.g. game just loaded).
    this.emitInitialMode();

    if (!this.ratingsTimer) {
      this.ratingsTimer = setTimeout(() => this.detectRatings(), 800);
    }

    // Watch board remount inside the same SPA page.
    const main = document.querySelector('.main-board');
    if (main) {
      this.observer = new MutationObserver(() => setTimeout(() => this.emitInitialMode(), 100));
      this.observer.observe(main, { childList: true });
    }

    return true;
  }

  private onSoundMove(x: LichessSoundArg) {
    if (!this.emit) return;

    // Storm / Racer payload shape: `{san, uci}` only — no fen, no ply.
    // Scrape the FEN from chessground DOM (the board has both the user's
    // move and the engine reply applied at this point) and emit.
    if ((typeof x?.fen !== 'string' || typeof x?.ply !== 'number') && isPuzCtxPage()) {
      // chessground may not have reflected the move yet — defer one tick.
      setTimeout(() => this.onStormMove(x), 0);
      return;
    }

    if (typeof x?.fen !== 'string' || typeof x?.ply !== 'number') {
      console.log(`${LOG} sound.move call without fen/ply — ignored`);
      return;
    }

    const ply = x.ply;
    const boardFen = x.fen;
    const fullFen = buildFullFen(boardFen, ply);
    const turn: Color = ply % 2 === 0 ? 'white' : 'black';
    const isGameOver = isGameOverStatus(x.status?.name);
    const gameEnd = deriveGameEnd(x.status?.name);

    this.lastFen = fullFen;
    this.lastPly = ply;
    this.lastGameOver = isGameOver;
    this.lastGameEnd = gameEnd;
    this.lastResult = statusToResult(x.status?.name, x.winner);

    console.log(`${LOG} ply=${ply} fen=${boardFen.slice(0, 22)}… turn=${turn} over=${isGameOver}`);

    this.emit({
      type: 'chessr:move',
      fen: fullFen,
      gameOver: isGameOver,
      gameEnd,
      turn,
    });

    this.emit({
      type: 'chessr:mode',
      name: isGameOver ? 'observing' : 'playing',
      playingAs: readOrientation(),
      fen: fullFen,
      gameOver: isGameOver,
      gameEnd,
      turn,
      result: this.lastResult,
    });

    // Puzzle wrong-move detection: schedule a DOM check after we just played
    // (turn is now opponent's). If Lichess silently reverts (no further
    // sound.move fires), we'll detect the diff and re-emit.
    if (!isGameOver && getPuzzle()) {
      const ourSide = readOrientation();
      const justPlayed = turn !== ourSide;
      if (justPlayed) {
        if (this.postMoveCheckTimer) clearTimeout(this.postMoveCheckTimer);
        this.postMoveCheckTimer = setTimeout(() => {
          this.postMoveCheckTimer = null;
          this.checkForSilentRevert();
        }, 700);
      }
    }
  }

  /** Storm/Racer sound.move handler. Scrapes board FEN, derives side-to-move
   *  from orientation (always user's turn after the combined move sound).
   *  `attempt` is the retry counter — chessground sometimes hasn't flushed
   *  yet on the first tick. Retry schedule (rAF, then 50/100/200ms) before
   *  giving up; total ~350ms. Dropping a move means stale arrows on the next
   *  puzzle, which the user sees as "old moves". */
  private onStormMove(x: LichessSoundArg, attempt = 0) {
    if (!this.emit) return;
    const boardFen = readBoardFenFromDom();
    if (!boardFen) {
      const schedule = [
        (cb: () => void) => requestAnimationFrame(cb),
        (cb: () => void) => setTimeout(cb, 50),
        (cb: () => void) => setTimeout(cb, 100),
        (cb: () => void) => setTimeout(cb, 200),
      ];
      if (attempt < schedule.length) {
        schedule[attempt](() => this.onStormMove(x, attempt + 1));
        return;
      }
      console.log(`${LOG} storm sound.move but DOM scrape failed after retries — ignored`);
      return;
    }
    const orientation = readOrientation();
    const sideChar = orientation === 'white' ? 'w' : 'b';
    const fullFen = `${boardFen} ${sideChar} - - 0 1`;

    // Same FEN as last time? Lichess can fire sound.move twice on rapid
    // transitions (combined sounds) — coalesce.
    if (this.lastFen && this.lastFen.split(/\s+/)[0] === boardFen) return;

    this.lastFen = fullFen;
    this.lastPly += 1;
    this.lastGameOver = false;
    this.lastGameEnd = null;
    this.lastResult = '*';

    console.log(`${LOG} storm/racer move uci=${x.uci ?? '?'} fen=${boardFen.slice(0, 22)}… turn=${orientation}`);

    this.emit({
      type: 'chessr:move',
      fen: fullFen,
      gameOver: false,
      gameEnd: null,
      turn: orientation,
    });
    this.emit({
      type: 'chessr:mode',
      name: 'playing',
      playingAs: orientation,
      fen: fullFen,
      gameOver: false,
      gameEnd: null,
      turn: orientation,
      result: '*',
    });
  }

  /** Compare DOM board to lastFen. If different and no sound.move arrived,
   *  Lichess silently reverted (wrong puzzle attempt). Re-emit so suggestions
   *  refresh on the reverted position. */
  private checkForSilentRevert() {
    if (!this.emit || !this.lastFen) return;
    const boardFen = readBoardFenFromDom();
    if (!boardFen) return;
    const lastBoardFen = this.lastFen.split(/\s+/)[0];
    if (boardFen === lastBoardFen) return;

    const orientation = readOrientation();
    const sideChar = orientation === 'white' ? 'w' : 'b';
    const fen = `${boardFen} ${sideChar} - - 0 1`;
    console.log(`${LOG} silent revert detected — re-emitting fen=${boardFen.slice(0, 22)}…`);

    this.lastFen = fen;
    // Side-to-move is now ours again (revert puts puzzle back to our move).
    this.emit({
      type: 'chessr:move',
      fen,
      gameOver: false,
      gameEnd: null,
      turn: orientation,
    });
    this.emit({
      type: 'chessr:mode',
      name: 'playing',
      playingAs: orientation,
      fen,
      gameOver: false,
      gameEnd: null,
      turn: orientation,
      result: '*',
    });
  }

  /** First mode push when the hook installs, before any move plays.
   *  On puzzles/storm/racer the user is expected to play the FIRST move —
   *  `sound.move` hasn't fired yet, so we scrape the initial FEN from the DOM
   *  and push it so suggestions can surface for the puzzle's opening
   *  position. For live round games we ALSO scrape on the start position
   *  (white-to-move is unambiguous before any move plays); mid-game the
   *  scrape is suppressed because we can't reliably derive side-to-move. */
  private emitInitialMode() {
    if (!this.emit) return;
    const orientation = readOrientation();
    const isPuzzle = !!getPuzzle();
    const stormish = isPuzCtxPage();
    const scrapeOnEmpty = isPuzzle || stormish;
    const STARTPOS_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

    let fen = this.lastFen;
    let turn: Color = this.lastPly % 2 === 0 ? 'white' : 'black';

    if (!fen && scrapeOnEmpty) {
      const boardFen = readBoardFenFromDom();
      if (boardFen) {
        // For puzzle/storm/racer the side to move equals the user's
        // orientation (the run/puzzle puts you on move). Castling as `-`.
        turn = orientation;
        const sideChar = orientation === 'white' ? 'w' : 'b';
        fen = `${boardFen} ${sideChar} - - 0 1`;
        this.lastFen = fen;
        console.log(`${LOG} initial FEN scraped from DOM (${stormish ? 'storm/racer' : 'puzzle'}): ${fen.slice(0, 40)}…`);
      }
    } else if (!fen && !isPuzzle && !stormish) {
      // Live round game: only emit a scrape if the board is at the starting
      // position. Otherwise we'd guess turn wrong on a mid-game join.
      const boardFen = readBoardFenFromDom();
      if (boardFen === STARTPOS_BOARD) {
        turn = 'white';
        fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        this.lastFen = fen;
        console.log(`${LOG} initial FEN scraped from DOM (round, startpos): ${fen.slice(0, 40)}…`);
      }
    }

    this.emit({
      type: 'chessr:mode',
      name: 'playing',
      playingAs: orientation,
      fen,
      gameOver: false,
      gameEnd: null,
      turn,
      result: '*',
    });

    if (fen) {
      // Also emit chessr:move so the suggestion subscribe wakes up immediately.
      this.emit({
        type: 'chessr:move',
        fen,
        gameOver: false,
        gameEnd: null,
        turn,
      });
    }

    console.log(`${LOG} emit initial mode (orientation=${orientation}, puzzle=${isPuzzle}, hasFen=${!!fen})`);
  }

  private onEndData(data: { winner?: Color; status?: { id?: number; name?: string } } | undefined) {
    if (!this.emit) return;
    const result = statusToResult(data?.status?.name, data?.winner);
    if (result === '*') return;
    this.lastGameOver = true;
    this.lastResult = result;
    this.lastGameEnd = deriveGameEnd(data?.status?.name);
    this.emit({
      type: 'chessr:gameOver',
      result,
      fen: this.lastFen ?? undefined,
      gameEnd: this.lastGameEnd,
    });
  }

  private detectRatings() {
    if (!this.emit || this.ratingsSent) return;
    const { playerRating, opponentRating } = readRatings();
    if (playerRating === null && opponentRating === null) return;
    console.log(`${LOG} ratings`, { playerRating, opponentRating });
    this.emit({ type: 'chessr:ratings', playerRating, opponentRating });
    this.ratingsSent = true;
  }

  private onUrlChange() {
    if (!this.emit) return;
    this.emit({ type: 'chessr:newGame' });
    this.lastFen = null;
    this.lastPly = 0;
    this.lastGameOver = false;
    this.lastResult = '*';
    this.lastGameEnd = null;
    this.ratingsSent = false;
    if (this.ratingsTimer) clearTimeout(this.ratingsTimer);
    this.ratingsTimer = setTimeout(() => this.detectRatings(), 800);
    if (this.postMoveCheckTimer) {
      clearTimeout(this.postMoveCheckTimer);
      this.postMoveCheckTimer = null;
    }
    // The hook persists across SPA nav (sound.move stays the same fn ref).
    // But we re-emit initial mode so the content script gets a fresh frame.
    setTimeout(() => this.emitInitialMode(), 100);
    setTimeout(() => this.emitInitialMode(), 500);
  }

  private dispose() {
    if (this.bootPoll) clearInterval(this.bootPoll);
    this.bootPoll = null;
    if (this.urlPoll) clearInterval(this.urlPoll);
    this.urlPoll = null;
    if (this.ratingsTimer) clearTimeout(this.ratingsTimer);
    this.ratingsTimer = null;
    if (this.postMoveCheckTimer) clearTimeout(this.postMoveCheckTimer);
    this.postMoveCheckTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    this.emit = null;
  }

  requestState(): void {
    if (!this.emit) return;
    if (this.lastFen) {
      this.emit({
        type: 'chessr:mode',
        name: this.lastGameOver ? 'observing' : 'playing',
        playingAs: readOrientation(),
        fen: this.lastFen,
        gameOver: this.lastGameOver,
        gameEnd: this.lastGameEnd,
        turn: this.lastPly % 2 === 0 ? 'white' : 'black',
        result: this.lastResult,
      });
    } else {
      this.emitInitialMode();
    }
  }

  async executeMove(uci: string, humanize?: HumanizeTiming): Promise<boolean> {
    if (!uci || uci.length < 4) return false;

    // Puzzle: prefer the public `playUci` method when available.
    const puzzle = getPuzzle();
    if (puzzle?.playUci) {
      if (humanize) {
        const total = humanize.pickDelay + humanize.selectDelay + humanize.moveDelay;
        if (total > 0) await new Promise((r) => setTimeout(r, total));
      }
      try {
        puzzle.playUci(uci);
        console.log(`${LOG} executeMove(puzzle) played`, uci);
        return true;
      } catch (err) {
        console.warn(`${LOG} puzzle.playUci failed`, err);
        return false;
      }
    }

    // Live game: synthesise mouse events on the chessground board.
    const board = document.querySelector('.cg-wrap cg-board') as HTMLElement | null;
    if (!board) {
      console.warn(`${LOG} executeMove: no cg-board`);
      return false;
    }

    const orientation = readOrientation();
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const fromPt = squareCenter(board, from, orientation);
    const toPt = squareCenter(board, to, orientation);
    if (!fromPt || !toPt) return false;

    const target = (document.elementFromPoint(fromPt.x, fromPt.y) as HTMLElement) ?? board;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    if (humanize) {
      await sleep(humanize.pickDelay);
      dispatchPointer(target, 'pointerdown', fromPt.x, fromPt.y);
      dispatchPointer(target, 'mousedown', fromPt.x, fromPt.y);
      await sleep(humanize.selectDelay);
      const target2 = (document.elementFromPoint(toPt.x, toPt.y) as HTMLElement) ?? board;
      await sleep(humanize.moveDelay);
      dispatchPointer(target2, 'pointerup', toPt.x, toPt.y);
      dispatchPointer(target2, 'mouseup', toPt.x, toPt.y);
    } else {
      dispatchPointer(target, 'pointerdown', fromPt.x, fromPt.y);
      dispatchPointer(target, 'mousedown', fromPt.x, fromPt.y);
      const target2 = (document.elementFromPoint(toPt.x, toPt.y) as HTMLElement) ?? board;
      dispatchPointer(target2, 'pointerup', toPt.x, toPt.y);
      dispatchPointer(target2, 'mouseup', toPt.x, toPt.y);
    }

    // Promotion: Lichess opens a `#promotion-choice` modal — pick the right
    // piece. Order: q, n, r, b (matching Lichess's UI top-to-bottom).
    const promo = uci[4];
    if (promo) {
      await sleep(80);
      const modal = document.querySelector('#promotion-choice');
      if (modal) {
        const map: Record<string, number> = { q: 0, n: 1, r: 2, b: 3 };
        const idx = map[promo.toLowerCase()] ?? 0;
        const choice = modal.children[idx] as HTMLElement | undefined;
        choice?.click();
      }
    }

    console.log(`${LOG} executeMove(round) ${uci} via mouse synthesis`);
    return true;
  }

  /** Premove: we just play the move while it's not our turn. chessground
   *  intercepts the click sequence and queues it as a premove automatically. */
  executePremove(uci: string): boolean {
    if (!uci || uci.length < 4) return false;
    void this.executeMove(uci);
    return true;
  }

  /** No-op fallback — there's no stable public API to cancel a premove
   *  programmatically. The user can right-click the board to cancel manually. */
  cancelPremoves(): void {
    /* nothing reliable to do without API access */
  }

  requestRematch(): boolean {
    // After game over, Lichess shows a rematch button under the board.
    // Try the most stable selectors.
    const candidates = [
      'button.rematch.fbt',
      '.rematch button',
      'button[data-icon=""]', // some themes
      '.rematch-decision .accept',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn) {
        btn.click();
        console.log(`${LOG} rematch via DOM click on ${sel}`);
        return true;
      }
    }
    console.warn(`${LOG} rematch: no button found`);
    return false;
  }
}
