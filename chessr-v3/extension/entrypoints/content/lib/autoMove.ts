// Thin wrappers that send messages to pageContext (MAIN world).
// pageContext handlers actually touch board.game.

export interface HumanizeDelays {
  pickDelay: number;
  selectDelay: number;
  moveDelay: number;
}

export function executeAutoMove(uciMove: string, humanize?: HumanizeDelays | null): void {
  window.postMessage({ type: 'chessr:executeMove', move: uciMove, humanize: humanize ?? null }, '*');
}

export function executePremove(uciMove: string): void {
  window.postMessage({ type: 'chessr:executePremove', move: uciMove }, '*');
}

export function cancelPremoves(): void {
  window.postMessage({ type: 'chessr:cancelPremoves' }, '*');
}
