/**
 * pageContext.js - Injected into Chess.com page context (world: MAIN)
 * Has access to wc-chess-board.game JS properties
 * Communicates with content script via CustomEvents
 */

(function () {
  console.log('[chessr:pageContext] Script loaded in MAIN world');
  let lastFen = null;
  let lastGameOver = false;

  function poll() {
    const board = document.querySelector('wc-chess-board');
    if (!board?.game) return;

    // FEN
    const fen = typeof board.game.getFEN === 'function' ? board.game.getFEN() : null;
    if (fen && fen !== lastFen) {
      lastFen = fen;
      window.postMessage({ type: 'chessr:boardFen', fen }, '*');
    }

    // Game over
    const gameOver = typeof board.game.isGameOver === 'function' ? board.game.isGameOver() : false;
    if (gameOver !== lastGameOver) {
      console.log(`[chessr:pageContext] gameOver changed: ${lastGameOver} → ${gameOver}`);
      lastGameOver = gameOver;
      if (gameOver) {
        console.log(`[chessr:pageContext] Dispatching chessr:gameOver`);
        window.postMessage({ type: 'chessr:gameOver', gameOver: true }, '*');
      }
    }
  }

  setInterval(poll, 300);
})();
