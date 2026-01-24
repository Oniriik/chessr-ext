const WebSocket = require('./server/node_modules/ws');

// Test remote server at ws.chessr.io
const REMOTE_URL = 'wss://ws.chessr.io';

console.log('🔗 Connexion au serveur distant:', REMOTE_URL);
const ws = new WebSocket(REMOTE_URL);

const TEST_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

ws.on('open', () => {
  console.log('✅ Connecté au serveur distant !');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('📩 Message reçu:', message.type);

    if (message.type === 'ready') {
      console.log('✅ Serveur prêt, envoi d\'une analyse...');
      ws.send(JSON.stringify({
        type: 'analyze',
        fen: TEST_FEN,
        searchMode: 'depth',
        depth: 10,
        moveTime: 1000,
        elo: 1500,
        mode: 'balanced',
        multiPV: 3
      }));
    } else if (message.type === 'info') {
      console.log('  📊 Profondeur:', message.depth, '| Éval:', message.evaluation);
    } else if (message.type === 'result') {
      console.log('✅ Résultat reçu !');
      console.log('  - Meilleur coup:', message.bestMove);
      console.log('  - Évaluation:', message.evaluation);
      console.log('  - Profondeur:', message.depth);
      console.log('  - Lignes:', message.lines.length);
      setTimeout(() => {
        console.log('✅ Test réussi !');
        ws.close();
      }, 100);
    } else if (message.type === 'error') {
      console.error('❌ Erreur serveur:', message.message);
      ws.close();
    }
  } catch (err) {
    console.error('❌ Erreur parsing:', err.message);
    ws.close();
  }
});

ws.on('close', (event) => {
  console.log('❌ Connexion fermée. Code:', event.code, 'Raison:', event.reason || 'aucune');
  process.exit(event.code === 1000 ? 0 : 1);
});

ws.on('error', (err) => {
  console.error('❌ Erreur de connexion:', err.message);
  console.error('   Vérifiez que le serveur distant est bien démarré et accessible');
  process.exit(1);
});

setTimeout(() => {
  console.log('⏱️  Timeout - pas de réponse dans les 30 secondes');
  ws.close();
  process.exit(1);
}, 30000);
