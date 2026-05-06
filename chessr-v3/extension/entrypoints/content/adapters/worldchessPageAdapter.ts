/**
 * worldchess.com page-context adapter.
 *
 * Worldchess is a Next.js (page chrome) + custom Svelte/React (game shell)
 * SPA. Game pages live at `/game/<uuid>`. The chess engine instance is
 * exposed on `window` under a per-game key:
 *
 *   window["chessEngine: <gameId>"]
 *
 * The instance has:
 *   - `move(uci, { isUserMove })` — async; routes through validation + WS
 *   - `store.on(field, cb, async = false)` — subscribe to state-field changes;
 *     fires immediately with current value at subscribe time
 *   - `store.get()` returning `{ currentFen, turn ('w'|'b'), lastMove,
 *     mainLineLastMove, history, pieces, checkmateData: { check, checkmate,
 *     kingIndex }, loading, ... }`
 *
 * We subscribe to `currentFen` for moves and `checkmateData` for game-over.
 * No `sound.move` monkey-patch needed — `currentFen` fires for every position
 * change, including the engine reply.
 *
 * Player color: read from the React wrapper component's `playerSide`
 * prop (memoizedProps), found by walking up the fiber chain from
 * `cg-board`'s parent. This is authoritative because it's what
 * worldchess itself uses to gate move input. Falls back to
 * rotation-based inference on layouts where the prop walk fails.
 * (The previous rotation-only inference broke on pages where worldchess
 * leaves the board un-flipped for black players or where the user
 * flipped the board manually.)
 *
 * Auto-move: `chessEngine.move(uci, { isUserMove: true })`. No mouse event
 * synthesis required — the public move() handles validation, animation, and
 * the WebSocket dispatch to the regional game server (`gs.<region>.worldchess.com`).
 *
 * Premoves are queued via chessground's `api.set({ premovable: { current } })`
 * — we discover the api object by walking common attach points around the
 * `cg-board` element (string keys + Symbol-keyed slots). When the lookup
 * fails (e.g. integration changed) we fall back to a regular `engine.move`
 * call which usually rejects when it's not our turn — at least it doesn't
 * crash.
 * No rematch flow — worldchess "New Game" leaves the page, so `requestRematch`
 * clicks the "New game" button when present and returns true.
 *
 * Logs are prefixed with `[Chessr worldchess]`.
 */

import type {
  ChessrPostMessage,
  Color,
  GameEnd,
  HumanizeTiming,
  PageContextAdapter,
} from './PageContextAdapter';

type Emit = (msg: ChessrPostMessage) => void;

interface WorldchessStore {
  get: () => WorldchessState;
  on: (field: string, cb: (...args: unknown[]) => void, asynchronous?: boolean) => () => void;
}

interface WorldchessState {
  currentFen?: string;
  turn?: 'w' | 'b';
  lastMove?: { from?: string; to?: string; fen?: string } | null;
  mainLineLastMove?: { from?: string; to?: string; fen?: string } | null;
  history?: unknown[];
  checkmateData?: { check?: boolean; checkmate?: boolean; kingIndex?: number };
  loading?: boolean;
}

interface WorldchessEngine {
  store: WorldchessStore;
  on: (field: string, cb: (...args: unknown[]) => void, asynchronous?: boolean) => () => void;
  move: (uci: string | string[], opts?: { isUserMove?: boolean; latest?: boolean; mode?: string; onError?: (e: unknown) => void }) => Promise<unknown>;
  loadFen?: (fen: string) => void;
  loadPgn?: (pgn: string) => void;
  restart?: () => void;
}

const LOG = '[Chessr worldchess]';

const GAME_URL_RE = /^\/game\/([0-9a-f-]{36})/i;

/** Extract the active game id from the URL, or null off a game page. */
function getGameIdFromUrl(): string | null {
  const m = location.pathname.match(GAME_URL_RE);
  return m ? m[1] : null;
}

/** Find the live chessEngine global. The key is `chessEngine: <gameId>`. */
function findChessEngine(gameId: string | null): WorldchessEngine | null {
  if (gameId) {
    const direct = (window as unknown as Record<string, unknown>)[`chessEngine: ${gameId}`];
    if (direct && typeof direct === 'object') return direct as WorldchessEngine;
  }
  // Fallback: any matching key (in case spacing/casing changes).
  for (const key of Object.keys(window)) {
    if (key.startsWith('chessEngine:')) {
      const v = (window as unknown as Record<string, unknown>)[key];
      if (v && typeof v === 'object' && typeof (v as WorldchessEngine).move === 'function') {
        return v as WorldchessEngine;
      }
    }
  }
  return null;
}

/** Read the logged-in user's worldchess profile id from the nav. The
 *  "My profile" entry in the user dropdown points at /profile/<id>.
 *  Falls back to scanning all /profile/<id> links and picking the one
 *  that doesn't appear inside a player card (the rest are opponent /
 *  player-card links). Returns null when logged out. */
function readMyProfileId(): string | null {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/profile/"]'));
  // English / FR / DE / ES / IT — covers worldchess's localised UI.
  const byText = links.find((a) => /my profile|mon profil|mein profil|mi perfil|il mio profilo/i.test(a.textContent ?? ''));
  let href = byText?.getAttribute('href');
  if (!href) {
    // Fallback: any profile link that's not nested in a GameLayoutPlayer
    // card belongs to the user (their dropdown / settings).
    const navLink = links.find((a) => !a.closest('[data-component="GameLayoutPlayer"]')
      && /^\/profile\/\d+/.test(a.getAttribute('href') ?? ''));
    href = navLink?.getAttribute('href') ?? '';
  }
  const m = href?.match(/^\/profile\/(\d+)/);
  return m ? m[1] : null;
}

/** Parse a card's rating text (the textContent of GamePlayerInfo with
 *  the username stripped). Returns null for unrated players ("New") or
 *  unparseable text. */
function parseRatingText(rawText: string, username: string): number | null {
  const stripped = rawText.replace(username, '').trim();
  if (!stripped || /^new$/i.test(stripped)) return null;
  const n = parseInt(stripped, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Worldchess bot names to a heuristic Elo. Bots don't have a
 *  GameLayoutPlayer card in the DOM (verified) and no rating is
 *  surfaced anywhere we can scrape — these are the names worldchess
 *  uses for its "Play vs Computer" levels and rough ratings drawn
 *  from their published curriculum. Update as new bot names appear. */
const BOT_ELO: Record<string, number> = {
  'club player': 1500,
  'beginner': 800,
  'intermediate': 1200,
  'advanced': 1700,
  'expert': 1900,
  'master': 2100,
  'grandmaster': 2400,
};

/** Extract the opponent's name from the page title — worldchess sets
 *  it to "<player> vs <opponent> / World Chess - ...". When the
 *  opponent matches a known bot name we use BOT_ELO; for unknown
 *  bots / non-game pages we return null (human opponents always have
 *  a player card so this fallback only fires on bot games). */
function readBotOpponentRating(): number | null {
  const m = document.title.match(/\bvs\s+([^/]+?)\s*\//i);
  if (!m) return null;
  const name = m[1].trim().toLowerCase();
  return BOT_ELO[name] ?? null;
}

/** Scrape player + opponent ratings off the worldchess game card DOM.
 *  Worldchess doesn't expose ratings in its store, only in the rendered
 *  React tree. Stable selectors: data-component="GameLayoutPlayer"
 *  (one per side), data-component="GamePlayerInfo" (name + rating
 *  block inside). The card whose profile-link matches the user's
 *  "My profile" id is the player; the other is the opponent. */
function readRatings(): { playerRating: number | null; opponentRating: number | null } {
  const myId = readMyProfileId();
  if (!myId) return { playerRating: null, opponentRating: null };

  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-component="GameLayoutPlayer"]'));
  let playerRating: number | null = null;
  let opponentRating: number | null = null;
  for (const card of cards) {
    const info = card.querySelector<HTMLElement>('[data-component="GamePlayerInfo"]');
    if (!info) continue;
    const links = Array.from(info.querySelectorAll<HTMLAnchorElement>('a[href^="/profile/"]'));
    // The first link wraps the avatar (no text); grab the one that has text.
    const nameLink = links.find((a) => (a.textContent ?? '').trim().length > 0);
    if (!nameLink) continue;
    const username = (nameLink.textContent ?? '').trim();
    const rating = parseRatingText(info.textContent ?? '', username);
    const profileHref = nameLink.getAttribute('href') ?? '';
    const isPlayer = profileHref.startsWith(`/profile/${myId}`);
    if (isPlayer) playerRating = rating; else opponentRating = rating;
  }
  // Bot games have no opponent card — fall back to the title-based bot
  // detection so the engine has a sensible per-game opponent rating to
  // tune against. Only fires when the DOM lookup found nothing for the
  // opponent (real human games keep their card-derived rating).
  if (opponentRating === null) {
    opponentRating = readBotOpponentRating();
  }
  return { playerRating, opponentRating };
}

/** Read board rotation from the chessground custom element. 0 = no flip. */
function readBoardRotation(): number {
  const board = document.querySelector('cg-board') as (HTMLElement & { rotation?: number }) | null;
  if (!board) return 0;
  return typeof board.rotation === 'number' ? board.rotation : 0;
}

/**
 * Read the user's actual playing color from the React wrapper component
 * around `cg-board`. The wrapper exposes `playerSide: 'w' | 'b'` in its
 * memoizedProps — this is what worldchess itself uses to decide which
 * side accepts move input, so it's authoritative.
 *
 * Why we don't just infer from `cg-board.rotation`:
 *   1. On some game pages worldchess doesn't auto-flip the board for
 *      black players (rotation stays 0 but the user is black).
 *   2. The user can flip mid-game via the "Flip Board" button, which
 *      changes rotation without changing their actual color.
 * Both cases would mis-detect with rotation-only logic.
 */
function readPlayerSide(): Color | null {
  const board = document.querySelector('cg-board');
  if (!board?.parentElement) return null;
  const fiberKey = Object.keys(board.parentElement).find((k) => k.startsWith('__reactFiber'));
  if (!fiberKey) return null;
  // Walk up the fiber tree until we find a node whose memoizedProps
  // carry `playerSide`. The wrapper component sits ~1-2 levels above
  // `cg-board` but we walk a generous range to survive integration
  // changes.
  let n: { memoizedProps?: { playerSide?: 'w' | 'b' }; return?: unknown } | undefined =
    (board.parentElement as unknown as Record<string, { memoizedProps?: { playerSide?: 'w' | 'b' }; return?: unknown }>)[fiberKey];
  for (let i = 0; n && i < 20; i++) {
    const ps = n.memoizedProps?.playerSide;
    if (ps === 'w') return 'white';
    if (ps === 'b') return 'black';
    n = n.return as typeof n;
  }
  return null;
}

/**
 * Convert a UCI square ("e2") into pixel coordinates on the cg-board,
 * accounting for the board rotation. The board is square (size in px
 * read from `getBoundingClientRect`) and laid out as 8×8 cells.
 *
 *   rotation === 0   → white at bottom, file a on the left
 *   rotation === 180 → black at bottom, file a on the right
 */
function squareToBoardPx(square: string, boardSize: number, rotation: number): { x: number; y: number } | null {
  if (square.length < 2) return null;
  const fileIdx = square.charCodeAt(0) - 97; // 'a' → 0, 'h' → 7
  const rankIdx = parseInt(square[1], 10) - 1;
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  const sq = boardSize / 8;
  let col: number, row: number;
  if (rotation === 0) {
    col = fileIdx;
    row = 7 - rankIdx;
  } else {
    col = 7 - fileIdx;
    row = rankIdx;
  }
  return { x: col * sq + sq / 2, y: row * sq + sq / 2 };
}

/**
 * Synthesize a mouse drag from `from` to `to` on the cg-board, mimicking
 * a user's pickup → drop. Worldchess's wrapper component listens to the
 * board's mousedown/move/up handlers and routes them through the same
 * pipeline as a real drag — including the premove detection branch when
 * it's not our turn (the React component owns `amountOfPremoves: 1`
 * which proves the feature is built-in, just not exposed via props).
 *
 * We use isolated MouseEvent dispatch (not PointerEvent) because the
 * cg-board's bound handlers are `boundMouseDown / boundMouseMove /
 * boundMouseUp` — wired to the legacy mouse event names.
 */
function synthesizeBoardDrag(uci: string): boolean {
  const board = document.querySelector('cg-board') as (HTMLElement & { rotation?: number }) | null;
  if (!board) return false;
  const rect = board.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const rotation = typeof board.rotation === 'number' ? board.rotation : 0;
  const from = squareToBoardPx(uci.slice(0, 2), rect.width, rotation);
  const to = squareToBoardPx(uci.slice(2, 4), rect.width, rotation);
  if (!from || !to) return false;

  const fire = (type: 'mousedown' | 'mousemove' | 'mouseup', dx: number, dy: number) => {
    const ev = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + dx,
      clientY: rect.top + dy,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
    });
    board.dispatchEvent(ev);
  };

  fire('mousedown', from.x, from.y);
  fire('mousemove', to.x, to.y);
  fire('mouseup', to.x, to.y);
  return true;
}

/** Build a full FEN from the store state. `currentFen` is already a full FEN
 *  on worldchess (six fields), but we defensively pad if it ever isn't. */
function normalizeFen(fen: string | undefined, turn: 'w' | 'b' | undefined): string | null {
  if (!fen || typeof fen !== 'string') return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length >= 6) return parts.slice(0, 6).join(' ');
  if (parts.length === 1) {
    return `${parts[0]} ${turn ?? 'w'} - - 0 1`;
  }
  const side = parts[1] ?? turn ?? 'w';
  const castling = parts[2] ?? '-';
  const ep = parts[3] ?? '-';
  const halfmove = parts[4] ?? '0';
  const fullmove = parts[5] ?? '1';
  return `${parts[0]} ${side} ${castling} ${ep} ${halfmove} ${fullmove}`;
}

function turnToColor(t: 'w' | 'b' | undefined): Color {
  return t === 'b' ? 'black' : 'white';
}

/** Derive a `GameEnd` shape from worldchess's `checkmateData`. The store
 *  doesn't expose stalemate / draw nuances on this field — only check and
 *  checkmate. Other ending kinds arrive via the result REST endpoint, which
 *  this adapter ignores for v1. */
function deriveGameEnd(d: WorldchessState['checkmateData']): GameEnd | null {
  if (!d?.checkmate) return null;
  return {
    checkmate: true,
    stalemate: false,
    draw: false,
    threefold: false,
    insufficient: false,
    fiftyMoveRule: false,
  };
}

export class WorldchessPageAdapter implements PageContextAdapter {
  private emit: Emit | null = null;
  private engine: WorldchessEngine | null = null;
  private gameId: string | null = null;
  private bootPoll: ReturnType<typeof setInterval> | null = null;
  private urlPoll: ReturnType<typeof setInterval> | null = null;
  private ratingsPoll: ReturnType<typeof setInterval> | null = null;
  private ratingsLast: { playerRating: number | null; opponentRating: number | null } =
    { playerRating: null, opponentRating: null };
  private lastUrl = '';

  // Snapshotted at install/new-game so user-toggled flip doesn't change it.
  private playerColor: Color | null = null;

  // store.on() returns a disposer; we keep them so we can unsubscribe on nav.
  private disposers: Array<() => void> = [];

  // De-dupe rapid identical FENs (chessEngine fires `currentFen` for each
  // store.dispatch even when the value didn't change).
  private lastFen: string | null = null;
  private lastGameOver = false;
  private lastResult = '*';
  private lastGameEnd: GameEnd | null = null;

  matches(host: string): boolean {
    return /(^|\.)worldchess\.com$/.test(host);
  }

  install(emit: Emit): () => void {
    this.emit = emit;
    this.lastUrl = location.href;
    console.log(`${LOG} install on`, location.href);

    (window as any).__chessrWorldchess = () => ({
      gameId: this.gameId,
      hasEngine: !!this.engine,
      lastFen: this.lastFen,
      lastGameOver: this.lastGameOver,
      playerColor: this.playerColor,
      boardRotation: readBoardRotation(),
    });

    let elapsed = 0;
    this.bootPoll = setInterval(() => {
      elapsed += 200;
      if (this.tryAttachEngine()) {
        if (this.bootPoll) { clearInterval(this.bootPoll); this.bootPoll = null; }
      } else if (elapsed >= 15000) {
        if (this.bootPoll) { clearInterval(this.bootPoll); this.bootPoll = null; }
        // Off-game pages (lobby, tournaments, etc.) never expose an engine —
        // this is normal, not a failure. Just go idle.
        console.log(`${LOG} no chessEngine after ${elapsed}ms — adapter idle`);
      }
    }, 200);

    this.urlPoll = setInterval(() => {
      if (location.href !== this.lastUrl) {
        const prev = this.lastUrl;
        this.lastUrl = location.href;
        console.log(`${LOG} SPA nav ${prev} → ${location.href}`);
        this.onUrlChange();
      }
    }, 500);

    this.startRatingsPoll(emit);

    return () => this.dispose();
  }

  /** Poll the player cards every 500ms until both ratings resolve OR a
   *  15s deadline expires — same shape as the chesscom adapter. Worldchess
   *  doesn't surface ratings on the engine store so DOM scraping is the
   *  only path. Re-emits on every change so partial detections (player
   *  card loaded but opponent still in matchmaking) reach the engine
   *  store and refine when the second card lands. */
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
        console.log(`${LOG} ratings`, r);
      }
      if ((r.playerRating !== null && r.opponentRating !== null) || elapsed >= 15000) {
        if (this.ratingsPoll) { clearInterval(this.ratingsPoll); this.ratingsPoll = null; }
      }
    };
    tick();
    this.ratingsPoll = setInterval(() => {
      elapsed += 500;
      tick();
    }, 500);
  }

  /** Idempotent: returns true once attached. */
  private tryAttachEngine(): boolean {
    if (this.engine) return true;

    const gameId = getGameIdFromUrl();
    if (!gameId) return false; // not on a game page

    const ce = findChessEngine(gameId);
    if (!ce) return false;

    this.engine = ce;
    this.gameId = gameId;

    // Player color comes from the React wrapper's `playerSide` prop —
    // authoritative even when the board orientation doesn't match (the
    // user flipped the board, or worldchess didn't auto-flip for black).
    // Falls back to rotation-based inference if the fiber walk fails
    // (preserves prior behavior on unfamiliar layouts).
    const sideFromFiber = readPlayerSide();
    const rotation = readBoardRotation();
    this.playerColor = sideFromFiber ?? (rotation === 0 ? 'white' : 'black');

    console.log(
      `${LOG} engine attached gameId=${gameId} playerColor=${this.playerColor}` +
      ` (source=${sideFromFiber ? 'fiber.playerSide' : 'rotation-fallback'} rotation=${rotation})`,
    );

    // Subscribe to currentFen for moves. The callback fires immediately with
    // the current value, which doubles as our initial-state push.
    const offFen = ce.store.on('currentFen', () => this.onFenChange());
    const offMate = ce.store.on('checkmateData', () => this.onCheckmate());

    this.disposers.push(offFen, offMate);
    return true;
  }

  private onFenChange() {
    if (!this.emit || !this.engine) return;
    const state = this.engine.store.get();
    const fen = normalizeFen(state.currentFen, state.turn);
    if (!fen) return;

    // De-dupe — same FEN as last emit means a no-op store dispatch.
    if (this.lastFen === fen) return;

    const turn = turnToColor(state.turn);
    const isMate = !!state.checkmateData?.checkmate;
    const gameEnd = deriveGameEnd(state.checkmateData);

    this.lastFen = fen;
    this.lastGameOver = isMate;
    this.lastGameEnd = gameEnd;
    if (isMate) {
      // checkmate: side to move just lost. Winner is the OTHER color.
      this.lastResult = turn === 'white' ? '0-1' : '1-0';
    }

    console.log(`${LOG} fen=${fen.slice(0, 22)}… turn=${turn} mate=${isMate}`);

    this.emit({
      type: 'chessr:move',
      fen,
      gameOver: isMate,
      gameEnd,
      turn,
    });

    this.emit({
      type: 'chessr:mode',
      name: isMate ? 'observing' : 'playing',
      playingAs: this.playerColor,
      fen,
      gameOver: isMate,
      gameEnd,
      turn,
      result: this.lastResult,
    });

    if (isMate) {
      this.emit({
        type: 'chessr:gameOver',
        result: this.lastResult,
        fen,
        turn,
        gameEnd,
      });
    }
  }

  private onCheckmate() {
    // Trigger a re-emit so gameOver flips. onFenChange handles the actual
    // state read; we just nudge it to re-evaluate.
    if (!this.engine) return;
    const state = this.engine.store.get();
    if (!state.checkmateData?.checkmate) return;
    if (this.lastGameOver) return; // already emitted
    // Force a re-emit by clearing dedupe key.
    this.lastFen = null;
    this.onFenChange();
  }

  private onUrlChange() {
    // Detach old engine subscriptions.
    for (const d of this.disposers) { try { d(); } catch { /* noop */ } }
    this.disposers.length = 0;
    this.engine = null;
    this.gameId = null;
    this.playerColor = null;
    this.lastFen = null;
    this.lastGameOver = false;
    this.lastResult = '*';
    this.lastGameEnd = null;

    if (this.emit) this.emit({ type: 'chessr:newGame' });

    // Re-poll player cards too — new game = new opponent (rating likely
    // changed) and the cards are torn down + rebuilt across SPA nav.
    if (this.emit) this.startRatingsPoll(this.emit);

    // Re-poll for a new engine if we're on another game page.
    if (!this.bootPoll) {
      let elapsed = 0;
      this.bootPoll = setInterval(() => {
        elapsed += 200;
        if (this.tryAttachEngine()) {
          if (this.bootPoll) { clearInterval(this.bootPoll); this.bootPoll = null; }
        } else if (elapsed >= 15000) {
          if (this.bootPoll) { clearInterval(this.bootPoll); this.bootPoll = null; }
        }
      }, 200);
    }
  }

  private dispose() {
    if (this.bootPoll) clearInterval(this.bootPoll);
    this.bootPoll = null;
    if (this.urlPoll) clearInterval(this.urlPoll);
    this.urlPoll = null;
    if (this.ratingsPoll) clearInterval(this.ratingsPoll);
    this.ratingsPoll = null;
    for (const d of this.disposers) { try { d(); } catch { /* noop */ } }
    this.disposers.length = 0;
    this.engine = null;
    this.emit = null;
  }

  requestState(): void {
    if (!this.emit) return;
    if (this.lastFen && this.engine) {
      const state = this.engine.store.get();
      this.emit({
        type: 'chessr:mode',
        name: this.lastGameOver ? 'observing' : 'playing',
        playingAs: this.playerColor,
        fen: this.lastFen,
        gameOver: this.lastGameOver,
        gameEnd: this.lastGameEnd,
        turn: turnToColor(state.turn),
        result: this.lastResult,
      });
    } else {
      // No engine yet — emit an idle mode so content script knows we're alive.
      this.emit({
        type: 'chessr:mode',
        name: 'idle',
        playingAs: null,
      });
    }
  }

  async executeMove(uci: string, humanize?: HumanizeTiming): Promise<boolean> {
    if (!uci || uci.length < 4) return false;
    const ce = this.engine;
    if (!ce || typeof ce.move !== 'function') {
      console.warn(`${LOG} executeMove: no engine`);
      return false;
    }
    if (humanize) {
      const total = humanize.pickDelay + humanize.selectDelay + humanize.moveDelay;
      if (total > 0) await new Promise((r) => setTimeout(r, total));
    }
    try {
      await ce.move(uci, { isUserMove: true });
      console.log(`${LOG} executeMove played ${uci}`);
      return true;
    } catch (err) {
      console.warn(`${LOG} engine.move failed`, err);
      return false;
    }
  }

  /**
   * Premove via synthesized mouse drag on the cg-board.
   *
   * Worldchess uses a CUSTOM `cg-board` element (not Lichess's
   * chessground despite the tag name) — its premove logic lives in a
   * React wrapper component that listens to mouse events on the board.
   * The wrapper is what holds `amountOfPremoves: 1` and routes "drag
   * during opponent's turn" → premove queue. There's no JS API exposed
   * to set a premove directly, so we mimic a user drag: mousedown on
   * the from-square center, mousemove + mouseup on the to-square. The
   * wrapper detects "not our turn" and queues it as a premove the same
   * way it would for a real user gesture.
   */
  executePremove(uci: string): boolean {
    if (!uci || uci.length < 4) return false;
    const ok = synthesizeBoardDrag(uci);
    if (!ok) {
      console.warn(`${LOG} premove drag synthesis failed (board missing or invalid uci) — uci=${uci}`);
      return false;
    }
    console.log(`${LOG} premove queued via drag synthesis: ${uci}`);
    return true;
  }

  cancelPremoves(): void {
    // No public cancel API on the wrapper. A right-click on the board
    // typically cancels in chessground / chessboard.js variants — we
    // could synthesize that here, but worldchess hasn't been observed
    // to need explicit cancellation in normal play (premoves auto-clear
    // on opponent's move arriving), so skip for now.
  }

  requestRematch(): boolean {
    // Worldchess has a "New game" button in the desktop control panel that
    // appears post-game. Clicking it navigates away to a new challenge —
    // closer to "queue rematch" than a true rematch flow, but it's the
    // closest analog.
    const candidates = [
      '[data-component="GameLayoutDesktopLeftControls"] button',
      '[data-component="GameLayoutMobileControlButtons"] button',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn && /new\s*game/i.test(btn.textContent ?? '')) {
        btn.click();
        console.log(`${LOG} rematch via DOM click on ${sel}`);
        return true;
      }
    }
    console.warn(`${LOG} rematch: no New Game button found`);
    return false;
  }
}
