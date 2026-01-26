# Chess Stockfish Server

Serveur WebSocket avec pool de moteurs Stockfish pour l'analyse d'échecs. Optimisé pour gérer plusieurs connexions simultanées avec mise à l'échelle automatique.

## Caractéristiques

- 🚀 Pool de moteurs Stockfish avec auto-scaling
- 🔌 API WebSocket simple
- ⚡ Gestion de plusieurs connexions simultanées
- 🎯 Support de différents modes de jeu (balanced, aggressive, positional)
- 📊 Support multi-PV (plusieurs variations)
- 🎚️ Ajustement du niveau ELO

## Déploiement sur VPS

Deux méthodes d'installation sont disponibles :

### Option 1 : Avec Docker (Recommandé - Plus Simple)

Installation rapide et isolée avec Docker.

📖 **[Guide complet Docker](../DEPLOYMENT_DOCKER.md)**

```bash
# Installation rapide
cd /opt
git clone votre-repo chess-server
cd chess-server
docker compose up -d
```

✅ Avantages :
- Installation en 2 minutes
- Isolation complète
- Mises à jour faciles
- Reproductible

### Option 2 : Installation Classique

Installation directe sur le système avec Node.js, PM2.

📖 **[Guide complet Installation Classique](../DEPLOYMENT.md)**

```bash
# Installation automatique
curl -fsSL https://votre-url/scripts/install-vps.sh | bash
```

✅ Avantages :
- Performances natives
- Plus de contrôle
- Debugging plus facile

## Développement Local

### Prérequis

- Node.js 18+
- Stockfish installé et dans le PATH

### Installation

```bash
cd server
npm install
```

### Développement

```bash
# Mode développement avec hot reload
npm run dev
```

### Build

```bash
# Compilation TypeScript
npm run build

# Démarrage production
npm start
```

## Utilisation de l'API

### Connexion WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  console.log('Connecté au serveur');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Message reçu:', message);
};
```

### Messages Client → Serveur

#### Analyser une position

```javascript
ws.send(JSON.stringify({
  type: 'analyze',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  searchMode: 'depth',  // ou 'time'
  depth: 20,
  moveTime: 1000,       // millisecondes (si searchMode = 'time')
  multiPV: 3,           // nombre de variations
  elo: 2000,            // niveau de jeu (optionnel)
  mode: 'balanced'      // 'balanced', 'aggressive', 'positional'
}));
```

#### Paramètres

- `type`: `'analyze'`
- `fen`: Position FEN à analyser
- `searchMode`: `'depth'` (profondeur) ou `'time'` (temps)
- `depth`: Profondeur de recherche (si searchMode = 'depth')
- `moveTime`: Temps de recherche en ms (si searchMode = 'time')
- `multiPV`: Nombre de variations (1-5)
- `elo`: Niveau ELO (500-3000, optionnel)
- `mode`: Style de jeu (optionnel)
  - `'balanced'`: Équilibré
  - `'aggressive'`: Agressif
  - `'positional'`: Positionnel

### Messages Serveur → Client

#### Message Ready

Envoyé à la connexion :

```javascript
{
  type: 'ready'
}
```

#### Info de recherche

Envoyé pendant l'analyse :

```javascript
{
  type: 'info',
  depth: 15,
  score: { type: 'cp', value: 50 },  // centipawns ou mate
  pv: ['e2e4', 'e7e5', 'g1f3'],      // variation principale
  nodes: 1234567,
  nps: 500000,
  time: 2468,
  multiPv: 1                           // numéro de la variation
}
```

#### Meilleur coup

Envoyé à la fin de l'analyse :

```javascript
{
  type: 'bestmove',
  bestMove: 'e2e4',
  ponder: 'e7e5'  // coup suivant suggéré
}
```

#### Erreur

```javascript
{
  type: 'error',
  message: 'Description de l\'erreur'
}
```

## Architecture

```
server/
├── src/
│   ├── index.ts              # Serveur WebSocket principal
│   ├── engine-pool.ts        # Pool de moteurs avec auto-scaling
│   ├── engine.ts             # Wrapper Komodo Dragon
│   └── types.ts              # Types TypeScript
├── dist/                     # Code compilé
├── package.json
├── tsconfig.json
├── Dockerfile                # Configuration Docker
└── README.md
```

### Pool de Moteurs

Le serveur utilise un pool de moteurs Stockfish qui s'adapte automatiquement :

- **Min Engines**: 2 moteurs toujours prêts
- **Max Engines**: 8 moteurs maximum
- **Scale Up**: Ajoute des moteurs si 2+ requêtes en attente
- **Scale Down**: Retire les moteurs inactifs après 1 minute

Cela permet de gérer efficacement plusieurs connexions simultanées tout en économisant les ressources.

## Configuration

### Variables d'environnement

Créez un fichier `.env` :

```env
PORT=3000
NODE_ENV=production
```

### Ajuster le pool

Modifiez `src/index.ts` :

```typescript
const POOL_CONFIG = {
  minEngines: 4,              // Plus de moteurs prêts
  maxEngines: 16,             // Plus de capacité
  scaleUpThreshold: 3,        // Seuil de montée en charge
  scaleDownIdleTime: 120000,  // Temps avant descente (ms)
  engineOptions: {
    threads: 4,               // Threads par moteur
    hash: 128                 // Mémoire hash (MB)
  }
};
```

## Tests

### Test avec wscat

```bash
# Installation de wscat
npm install -g wscat

# Connexion
wscat -c ws://localhost:3000

# Envoyer un message
> {"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":15,"multiPV":1}
```

### Test avec curl

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  http://localhost:3000
```

## Monitoring

### Avec PM2

```bash
pm2 status
pm2 logs chess-stockfish-server
pm2 monit
```

### Avec Docker

```bash
docker compose logs -f
docker stats
```

## Performance

### Benchmarks

Sur un VPS avec 4 CPU / 8 GB RAM :

- **Connexions simultanées**: 50+
- **Analyses/seconde**: 20+
- **Profondeur moyenne (1s)**: 18-22 coups
- **Nœuds/seconde**: 500k-2M par moteur

### Optimisation

1. **Plus de CPUs** : Augmentez `threads` dans engineOptions
2. **Plus de RAM** : Augmentez `hash` dans engineOptions
3. **Plus de moteurs** : Augmentez `maxEngines`
4. **Meilleur CPU** : Préférez CPU avec AVX2/AVX512

## Sécurité

✅ Mise en place :
- Firewall (UFW)
- Rate limiting
- Utilisateur non-root
- Isolation (Docker)

⚠️ Recommandations supplémentaires :
- Authentification pour l'API
- HTTPS/WSS avec certificat SSL
- Surveillance des logs
- Sauvegardes régulières

## Support

Pour les questions et problèmes :

1. Consultez les guides de déploiement
2. Vérifiez les logs (`pm2 logs` ou `docker compose logs`)
3. Testez avec wscat
4. Vérifiez que Stockfish est installé (`which stockfish`)

## Licence

MIT
