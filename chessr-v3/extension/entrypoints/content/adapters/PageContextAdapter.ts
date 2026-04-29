/**
 * Platform adapter contract for the MAIN-world page-context script.
 *
 * Each adapter owns the full game-lifecycle observation for one chess platform
 * (chess.com, lichess.org, ...) and emits a normalized stream of `chessr:*`
 * postMessages that the ISOLATED-world content script consumes via
 * `window.addEventListener('message', ...)`.
 *
 * The wire format of the emitted messages MUST stay stable across adapters —
 * `content.tsx` doesn't know which platform produced a given event.
 */

export type Color = 'white' | 'black';

export interface GameEnd {
  checkmate: boolean;
  stalemate: boolean;
  draw: boolean;
  threefold: boolean;
  insufficient: boolean;
  fiftyMoveRule: boolean;
}

export interface ChessrMoveMsg {
  type: 'chessr:move';
  fen: string;
  gameOver: boolean;
  gameEnd: GameEnd | null;
  turn: Color;
}

export interface ChessrModeMsg {
  type: 'chessr:mode';
  name: string | null;
  playingAs: Color | null;
  fen?: string | null;
  gameOver?: boolean;
  gameEnd?: GameEnd | null;
  turn?: Color | null;
  result?: string;
}

export interface ChessrNewGameMsg {
  type: 'chessr:newGame';
}

export interface ChessrGameOverMsg {
  type: 'chessr:gameOver';
  result: string;
  fen?: string;
  turn?: Color;
  gameEnd?: GameEnd | null;
}

export interface ChessrRatingsMsg {
  type: 'chessr:ratings';
  playerRating: number | null;
  opponentRating: number | null;
}

export type ChessrPostMessage =
  | ChessrMoveMsg
  | ChessrModeMsg
  | ChessrNewGameMsg
  | ChessrGameOverMsg
  | ChessrRatingsMsg;

export interface HumanizeTiming {
  pickDelay: number;
  selectDelay: number;
  moveDelay: number;
}

export interface PageContextAdapter {
  /** Hostname predicate. Returns true if this adapter should run on `host`. */
  matches(host: string): boolean;

  /**
   * Start observing the page. The adapter calls `emit` with normalized messages
   * whenever the underlying platform reports a change.
   * Returns a disposer for tests / hot-reload.
   */
  install(emit: (msg: ChessrPostMessage) => void): () => void;

  /** Auto-play: execute a UCI move (`"e2e4"` / `"e7e8q"` for promotions). */
  executeMove(uci: string, humanize?: HumanizeTiming): Promise<boolean>;

  /** Queue a premove. Returns false if not supported in the current state. */
  executePremove(uci: string): boolean;

  /** Cancel any queued premove(s). */
  cancelPremoves(): void;

  /** Request a rematch on the current finished game. Returns false if N/A. */
  requestRematch(): boolean;

  /** Re-emit the current state (mode + last position). Wired to
   *  `chessr:requestState` postMessages from the content script. Optional —
   *  adapters that have nothing to re-emit can leave it unset. */
  requestState?(): void;
}
