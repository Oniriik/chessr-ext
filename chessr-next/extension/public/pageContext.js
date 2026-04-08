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

    // Game over (via getPositionInfo)
    const posInfo = typeof board.game.getPositionInfo === 'function' ? board.game.getPositionInfo() : null;
    const gameOver = posInfo ? posInfo.gameOver : false;
    if (gameOver !== lastGameOver) {
      console.log(`[chessr:pageContext] gameOver changed: ${lastGameOver} → ${gameOver}`);
      lastGameOver = gameOver;
      if (gameOver) {
        console.log(`[chessr:pageContext] Dispatching chessr:gameOver`);
        window.postMessage({ type: 'chessr:gameOver', gameOver: true }, '*');

        // Auto-rematch: click New Game tab then Play button
        if (autoRematch) {
          setTimeout(function () {
            try {
              var btn = document.querySelector('button.cc-button-primary');
              if (btn) {
                btn.click();
                console.log('[chessr:pageContext] Auto-rematch triggered:', btn.textContent.trim());
              } else {
                console.warn('[chessr:pageContext] Auto-rematch: no Start Game button found');
              }
            } catch (err) {
              console.error('[chessr:pageContext] Auto-rematch failed:', err);
            }
          }, 1500);
        }
      }
    }
  }

  // Listen for messages from content script
  var autoRematch = false;

  function emitPieceEvents(board, from) {
    var piece = board.game.getPiece(from);
    if (piece) {
      board.game.emit('PieceClicked', { type: 'PieceClicked', data: { piece: piece, square: from } });
      board.game.emit('PieceSelected', { type: 'PieceSelected', data: { piece: piece, square: from } });
    }
  }

  window.addEventListener('message', function (e) {
    if (e.data?.type === 'chessr:setAutoRematch') {
      autoRematch = e.data.enabled;
      console.log('[chessr:pageContext] Auto-rematch:', autoRematch);
      return;
    }

    if (e.data?.type === 'chessr:executeMove') {
      var m = e.data.move;
      var h = e.data.humanize;
      var board = document.querySelector('wc-chess-board');
      if (!board?.game?.move) return;
      var from = m.slice(0, 2);
      var to = m.slice(2, 4);
      var promotion = m[4];

      if (h && (h.pickDelay || h.selectDelay || h.moveDelay)) {
        // Humanized: PieceClicked → wait → PieceSelected → wait → move
        var piece = board.game.getPiece(from);
        setTimeout(function () {
          if (piece) {
            board.game.emit('PieceClicked', { type: 'PieceClicked', data: { piece: piece, square: from } });
          }
          setTimeout(function () {
            if (piece) {
              board.game.emit('PieceSelected', { type: 'PieceSelected', data: { piece: piece, square: from } });
            }
            setTimeout(function () {
              var moveObj = { from: from, to: to, userGenerated: true, animate: false };
              if (promotion) { moveObj.promotion = promotion; }
              board.game.move(moveObj);
              console.log('[chessr:pageContext] Humanized move:', m,
                'delays:', h.pickDelay + '+' + h.selectDelay + '+' + h.moveDelay + 'ms');
            }, h.moveDelay);
          }, h.selectDelay);
        }, h.pickDelay);
      } else {
        // Instant: all at once
        emitPieceEvents(board, from);
        var moveObj = { from: from, to: to, userGenerated: true, animate: false };
        if (promotion) { moveObj.promotion = promotion; }
        board.game.move(moveObj);
        console.log('[chessr:pageContext] Auto-move executed:', m);
      }
      return;
    }

    if (e.data?.type === 'chessr:executePremove') {
      var m = e.data.move;
      var board = document.querySelector('wc-chess-board');
      if (!board?.game?.premoves?.move) return;
      var from = m.slice(0, 2);
      var to = m.slice(2, 4);
      var promotion = m[4];

      emitPieceEvents(board, from);

      var moveObj = { from: from, to: to };
      if (promotion) { moveObj.promotion = promotion; }
      board.game.premoves.move(moveObj, null);
      console.log('[chessr:pageContext] Premove queued:', m);
      return;
    }

    if (e.data?.type === 'chessr:cancelPremoves') {
      var board = document.querySelector('wc-chess-board');
      if (board?.game?.premoves?.cancel) {
        board.game.premoves.cancel();
        console.log('[chessr:pageContext] Premoves cancelled');
      }
      return;
    }
  });

  setInterval(poll, 300);
})();
