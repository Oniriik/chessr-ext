const WebSocket = require('./server/node_modules/ws');

const ws = new WebSocket('ws://localhost:3000');

// Use exact same FEN that extension sent
const FEN = 'rnb1kbnr/pppp1ppp/4p3/4P3/4q3/8/PPP2PPP/RNB1KBNR w KQkq - 0 1';

ws.on('open', () => {
  console.log('✅ Connecté au serveur');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📩 Message reçu:', message.type, message);

  if (message.type === 'ready') {
    console.log('🚀 Envoi du FEN de l\'extension:', FEN);
    // Use exact same params as extension
    ws.send(JSON.stringify({
      type: 'analyze',
      fen: FEN,
      searchMode: 'depth',
      depth: 10,
      moveTime: 1000,
      elo: 1500,
      mode: 'balanced',
      multiPV: 3
    }));
  }

  if (message.type === 'result') {
    console.log('✅ Résultat reçu:');
    console.log('  - bestMove:', message.bestMove);
    console.log('  - evaluation:', message.evaluation);
    console.log('  - lines:', message.lines.length);
    setTimeout(() => {
      ws.close();
    }, 100);
  }

  if (message.type === 'error') {
    console.error('❌ Erreur serveur:', message.message);
    ws.close();
  }
});

ws.on('close', () => {
  console.log('Connexion fermée');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('⏱️  Timeout');
  ws.close();
  process.exit(1);
}, 30000);
