/**
 * pageContextLichess.js - Injected into Lichess page context (world: MAIN)
 * Captures the WebSocket and executes moves via it
 */

(function () {
  console.log('[chessr:pageContextLichess] Script loaded in MAIN world');
  var lichessWs = null;
  var ackCounter = 0;
  var origSend = WebSocket.prototype.send;

  WebSocket.prototype.send = function (data) {
    if (this.url && this.url.includes('lichess') && !lichessWs) {
      lichessWs = this;
    }
    // Track ack counter from real moves
    if (typeof data === 'string' && data.includes('"t":"move"')) {
      try {
        var parsed = JSON.parse(data);
        if (parsed.d && parsed.d.a) ackCounter = parsed.d.a;
      } catch (_) {}
    }
    return origSend.call(this, data);
  };

  window.addEventListener('message', function (e) {
    if (e.data?.type !== 'chessr:executeMove') return;
    if (!lichessWs || lichessWs.readyState !== 1) {
      console.warn('[chessr:pageContextLichess] No open WebSocket');
      return;
    }
    var move = e.data.move;
    ackCounter++;
    var msg = { t: 'move', d: { u: move, b: 1, a: ackCounter } };
    lichessWs.send(JSON.stringify(msg));
    console.log('[chessr:pageContextLichess] Move sent:', move, 'ack:', ackCounter);
  });
})();
