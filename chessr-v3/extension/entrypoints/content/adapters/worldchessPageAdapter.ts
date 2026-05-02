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
 * Player color: derived from `cg-board.rotation` on the chessground custom
 * element. `rotation === 0` → white at bottom → user is white. The user can
 * flip the board manually mid-game (the "Flip Board" toolbar button), so we
 * snapshot rotation once on first install and treat that as authoritative.
 *
 * Auto-move: `chessEngine.move(uci, { isUserMove: true })`. No mouse event
 * synthesis required — the public move() handles validation, animation, and
 * the WebSocket dispatch to the regional game server (`gs.<region>.worldchess.com`).
 *
 * No premove API surfaced; `executePremove` is a best-effort fire-and-forget.
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

    // Snapshot orientation once, before any user flip.
    const rotation = readBoardRotation();
    this.playerColor = rotation === 0 ? 'white' : 'black';

    console.log(`${LOG} engine attached gameId=${gameId} playerColor=${this.playerColor} rotation=${rotation}`);

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

  /** No public premove API — fire the move; if it's not our turn the engine
   *  will reject. Best-effort. */
  executePremove(uci: string): boolean {
    if (!uci || uci.length < 4) return false;
    void this.executeMove(uci);
    return true;
  }

  cancelPremoves(): void {
    /* no premove API surfaced */
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
