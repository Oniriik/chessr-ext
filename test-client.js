const WebSocket = require('./server/node_modules/ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('✅ Connecté au serveur');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📩 Message reçu:', JSON.stringify(message, null, 2));

  // Si on reçoit ready, envoyer une demande d'analyse
  if (message.type === 'ready') {
    console.log('🚀 Envoi d\'une demande d\'analyse...');
    ws.send(JSON.stringify({
      type: 'analyze',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      searchMode: 'depth',
      depth: 10,
      moveTime: 1000,
      elo: 1500,
      mode: 'balanced',
      multiPV: 3
    }));
  }

  // Si on reçoit un résultat, fermer la connexion
  if (message.type === 'result') {
    console.log('✅ Résultat d\'analyse reçu');
    ws.close();
  }
});

ws.on('close', () => {
  console.log('❌ Connexion fermée');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
});

// Timeout après 30 secondes
setTimeout(() => {
  console.log('⏱️  Timeout - aucun résultat reçu');
  ws.close();
  process.exit(1);
}, 30000);
