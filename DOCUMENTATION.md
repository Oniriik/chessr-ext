# 📚 Documentation Complète - ChessR

Documentation centrale du projet ChessR - Extension Chrome d'analyse d'échecs avec serveur Stockfish.

---

## 📋 Table des matières

1. [Architecture du Projet](#-architecture-du-projet)
2. [Identifiants et Accès](#-identifiants-et-accès)
3. [Scripts de Gestion](#-scripts-de-gestion)
4. [Structure de la Codebase](#-structure-de-la-codebase)
5. [API WebSocket](#-api-websocket)
6. [Workflows de Développement](#-workflows-de-développement)
7. [Dépannage](#-dépannage)

---

## 🏗️ Architecture du Projet

### Vue d'ensemble

```
chess/
├── server/              # Serveur Stockfish WebSocket (Node.js + TypeScript)
├── extension/           # Extension Chrome (React + TypeScript + Tailwind)
├── landing/             # Site vitrine (Next.js)
├── nginx/               # Configuration reverse proxy
├── scripts/             # Scripts de déploiement et configuration
└── *.sh                 # Scripts de gestion du serveur
```

### Composants principaux

#### 1. **Server** - Serveur d'analyse Stockfish
- **Technologie:** Node.js, TypeScript, WebSocket (ws)
- **Rôle:** Fournit l'analyse d'échecs via Stockfish avec système de pool
- **Port:** 3000
- **URL Production:** `wss://ws.chessr.io`

#### 2. **Extension** - Extension Chrome
- **Technologie:** React, TypeScript, Tailwind CSS, Zustand
- **Rôle:** Interface utilisateur dans le navigateur
- **Plateformes supportées:** Chess.com, Lichess.org

#### 3. **Landing** - Site vitrine
- **Technologie:** Next.js 15, React 19
- **Rôle:** Page de présentation et téléchargement
- **URL:** https://chessr.io

#### 4. **Nginx** - Reverse Proxy
- **Rôle:** SSL/TLS, proxy WebSocket, routing
- **Certificats:** Let's Encrypt

---

## 🔐 Identifiants et Accès

### Serveur VPS OVH

| Information | Valeur |
|-------------|--------|
| **Nom d'hôte** | vps-8058cb7f.vps.ovh.net |
| **Adresse IP** | 135.125.201.246 |
| **Utilisateur SSH** | ubuntu |
| **Mot de passe** | Chess2026SecurePass! |
| **Port SSH** | 22 |
| **Authentification** | Clé SSH + Password |

### Connexion SSH rapide
```bash
./ssh-connect.sh                  # Connexion interactive
./ssh-connect.sh "commande"       # Exécution de commande
```

### Serveur Chess Stockfish

| Information | Valeur |
|-------------|--------|
| **URL WebSocket (Production)** | wss://ws.chessr.io |
| **URL WebSocket (IP directe)** | ws://135.125.201.246:3000 |
| **Port** | 3000 |
| **Container Docker** | chess-stockfish-server |
| **Moteurs Stockfish** | 2-8 (auto-scaling) |
| **Threads par moteur** | 2 |
| **Hash par moteur** | 64 MB |

### Domaines

| Domaine | IP | Usage |
|---------|-----|-------|
| chessr.io | 135.125.201.246 | Landing page (Next.js) |
| ws.chessr.io | 135.125.201.246 | WebSocket Stockfish |

### Fichiers sur le serveur

```
/home/ubuntu/
├── chess-server/              # Code serveur Stockfish
│   ├── src/                   # Sources TypeScript
│   ├── dist/                  # Build JavaScript
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── package.json
├── nginx-config/              # Configuration Nginx
└── chessr.io/                 # Landing page Next.js
```

---

## 🛠️ Scripts de Gestion

Tous les scripts sont à la racine du projet et nécessitent `expect` installé.

### Scripts de déploiement

#### `./deploy-server.sh`
**Déploie une nouvelle version du serveur Stockfish**

```bash
./deploy-server.sh
```

**Étapes automatiques:**
1. Build local du serveur (`npm run build`)
2. Création d'une archive tar.gz
3. Upload via SCP vers le serveur
4. Extraction sur le serveur
5. Rebuild Docker (`docker compose up --build -d`)
6. Vérification des logs

**Durée:** ~2-3 minutes
**Utilisation:** Après modification du code serveur

---

### Scripts de monitoring

#### `./check-server-status.sh`
**Vérifie l'état complet du serveur**

```bash
./check-server-status.sh
```

**Affiche:**
- État du container Docker
- Health check status
- Derniers logs (20 lignes)
- Test de connexion WebSocket

**Durée:** ~15 secondes

---

#### `./view-remote-logs.sh [lignes]`
**Affiche les derniers logs du serveur**

```bash
./view-remote-logs.sh        # 30 dernières lignes (défaut)
./view-remote-logs.sh 100    # 100 dernières lignes
```

**Utilisation:** Debug, vérification d'activité

---

#### `./follow-remote-logs.sh`
**Suit les logs en temps réel**

```bash
./follow-remote-logs.sh
# Ctrl+C pour arrêter
```

**Utilisation:** Debug en temps réel, monitoring

---

### Scripts de contrôle

#### `./restart-remote-server.sh`
**Redémarre le serveur Docker (sans rebuild)**

```bash
./restart-remote-server.sh
```

**Durée:** ~10 secondes
**Utilisation:** Serveur bloqué, changement config

---

#### `./ssh-connect.sh [commande]`
**Connexion SSH ou exécution de commande**

```bash
# Connexion interactive
./ssh-connect.sh

# Exécution de commande
./ssh-connect.sh "sudo docker ps"
./ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"
./ssh-connect.sh "cd /home/ubuntu/chess-server && ls -la"
```

---

### Scripts de test

#### `test-remote-server.js`
**Test simple de connexion au serveur**

```bash
node test-remote-server.js
```

**Teste:**
- Connexion WebSocket
- Message "ready"
- Analyse d'une position
- Réception du résultat

---

#### `test-remote-debug.js`
**Test détaillé avec tous les messages**

```bash
node test-remote-debug.js
```

**Affiche:**
- Tous les messages échangés
- Info updates pendant l'analyse
- Détails complets du résultat

---

#### `test-connection.sh`
**Test bash avec wscat**

```bash
./test-connection.sh
```

---

## 📁 Structure de la Codebase

### Server (`/server`)

```
server/
├── src/
│   ├── index.ts              # Serveur WebSocket principal
│   ├── stockfish.ts          # Wrapper Stockfish avec timeout
│   ├── stockfish-pool.ts     # Pool de moteurs avec auto-scaling
│   ├── move-selector.ts      # Sélection de coups basée sur ELO
│   └── types.ts              # Types TypeScript
├── dist/                     # Build JavaScript
├── Dockerfile                # Image Docker multi-stage
├── docker-compose.yml        # Configuration Docker
├── package.json
└── tsconfig.json
```

#### Fichiers clés

**`stockfish.ts`**
- Gère un processus Stockfish individuel
- Parse les messages UCI
- **Nouveau:** Timeout sur les analyses (moveTime + 5s)
- Validation FEN avant analyse

**`stockfish-pool.ts`**
- Pool de 2-8 moteurs Stockfish
- Auto-scaling basé sur la charge
- Sélection de coups humanisée par ELO
- Recovery automatique en cas d'erreur

**`move-selector.ts`**
- Algorithme de sélection de coups par ELO
- Probabilités de "mistakes" selon le niveau
- Recommandation de MultiPV par ELO

**`index.ts`**
- Serveur WebSocket (ws)
- Routage des messages
- Gestion des connexions clients

---

### Extension (`/extension`)

```
extension/
├── src/
│   ├── content/              # Scripts injectés dans les pages
│   │   ├── board-detector.ts       # Détection plateau
│   │   ├── move-tracker.ts         # Suivi des coups
│   │   ├── position-parser.ts      # Parsing FEN
│   │   ├── websocket-client.ts     # Client WebSocket
│   │   ├── overlay/                # Rendu des overlays
│   │   └── openings/               # Base de données d'ouvertures
│   ├── presentation/         # UI React
│   │   ├── components/             # Composants UI
│   │   └── store/                  # État Zustand
│   ├── infrastructure/       # Services externes
│   │   ├── supabase/               # Authentification
│   │   └── repository/             # Persistance
│   ├── domain/               # Logique métier
│   ├── shared/               # Utils partagés
│   └── i18n/                 # Internationalisation (FR/EN)
├── public/                   # Assets statiques
├── dist/                     # Build de l'extension
├── manifest.json             # Manifest Chrome Extension v3
└── package.json
```

#### Architecture

**Pattern:** Domain-Driven Design (DDD) + Clean Architecture

- **Presentation:** UI React, stores Zustand
- **Domain:** Logique métier pure
- **Infrastructure:** Services externes (Supabase, WebSocket)
- **Content Scripts:** Injection dans Chess.com/Lichess

---

### Landing (`/landing`)

```
landing/
├── app/                      # Next.js 15 App Router
│   ├── page.tsx              # Page d'accueil
│   ├── layout.tsx            # Layout principal
│   └── globals.css           # Styles globaux
├── components/               # Composants React
├── public/                   # Assets
└── package.json
```

---

## 🔌 API WebSocket

### Connexion

```javascript
const ws = new WebSocket('wss://ws.chessr.io');

ws.onopen = () => {
  console.log('Connecté au serveur Stockfish');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Message reçu:', message);
};
```

---

### Messages Client → Serveur

#### Analyser une position

```typescript
{
  type: 'analyze',
  fen: string,              // Position FEN
  searchMode: 'depth' | 'time',
  depth: number,            // Profondeur (ex: 18)
  moveTime: number,         // Temps en ms (ex: 1000)
  multiPV: number,          // Nombre de lignes (1-8)
  elo: number,              // Niveau ELO (400-3200)
  mode: 'safe' | 'balanced' | 'aggressive' | 'blitz' | 'positional' | 'tactical'
}
```

**Exemple:**
```javascript
ws.send(JSON.stringify({
  type: 'analyze',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  searchMode: 'time',
  depth: 18,
  moveTime: 1000,
  multiPV: 3,
  elo: 1500,
  mode: 'balanced'
}));
```

---

### Messages Serveur → Client

#### 1. Ready (connexion établie)
```typescript
{
  type: 'ready'
}
```

#### 2. Info (pendant l'analyse)
```typescript
{
  type: 'info',
  depth: number,       // Profondeur actuelle
  evaluation: number,  // Évaluation en pawns
  mate?: number        // Nombre de coups avant mat (si applicable)
}
```

#### 3. Result (résultat final)
```typescript
{
  type: 'result',
  bestMove: string,        // Meilleur coup (ex: 'e2e4')
  ponder?: string,         // Coup à anticiper
  evaluation: number,      // Évaluation finale
  mate?: number,           // Mat en X coups
  lines: Array<{          // Lignes d'analyse
    moves: string[],       // Séquence de coups
    evaluation: number,
    mate?: number
  }>,
  depth: number            // Profondeur atteinte
}
```

#### 4. Error
```typescript
{
  type: 'error',
  message: string
}
```

---

## 🔄 Workflows de Développement

### Modifier le serveur Stockfish

```bash
# 1. Modifier le code dans server/src/
cd server
code src/stockfish.ts

# 2. Tester localement
npm run dev

# 3. Tester avec un client
node ../test-client.js

# 4. Si OK, déployer
cd ..
./deploy-server.sh

# 5. Vérifier le déploiement
./check-server-status.sh
node test-remote-debug.js
```

---

### Modifier l'extension

```bash
# 1. Modifier le code
cd extension
code src/

# 2. Build en mode dev
npm run dev

# 3. Recharger l'extension dans Chrome
# chrome://extensions > Recharger

# 4. Tester sur Chess.com ou Lichess

# 5. Build production
npm run build:prod

# 6. Package pour publication
npm run package
```

---

### Modifier la landing page

```bash
cd landing
npm run dev              # Dev server sur http://localhost:3000
# Modifier dans app/
npm run build            # Build production
```

---

### Workflow complet d'une feature

```bash
# 1. Modifier le serveur
cd server/src
# ... modifications ...
cd ..
npm run build
cd ..

# 2. Déployer le serveur
./deploy-server.sh

# 3. Modifier l'extension
cd extension/src
# ... modifications ...
cd ..
npm run build:prod

# 4. Tester l'intégration
node ../test-remote-debug.js
# Puis tester manuellement l'extension sur Chess.com

# 5. Vérifier les logs serveur
./follow-remote-logs.sh
```

---

## 🚨 Dépannage

### Le serveur ne répond plus

```bash
# 1. Vérifier le statut
./check-server-status.sh

# 2. Voir les logs récents
./view-remote-logs.sh 50

# 3. Rechercher les erreurs
./view-remote-logs.sh 200 | grep -i error

# 4. Redémarrer
./restart-remote-server.sh

# 5. Vérifier après redémarrage
./check-server-status.sh
```

---

### Stockfish reste bloqué sur une analyse

**Symptôme:** Le serveur reçoit des `analyze` mais ne répond jamais

**Solution:** Déjà implémentée dans `stockfish.ts:162`
- Timeout automatique (moveTime + 5s ou 30s)
- Le moteur est marqué non-ready en cas de timeout
- Le pool redémarre automatiquement le moteur

**Vérification:**
```bash
./view-remote-logs.sh | grep -i timeout
```

---

### L'extension ne se connecte pas au serveur

**Vérifications:**

1. **Serveur en ligne?**
```bash
./check-server-status.sh
```

2. **WebSocket accessible?**
```bash
node test-remote-server.js
```

3. **Certificat SSL valide?**
```bash
curl -I https://ws.chessr.io
```

4. **Logs extension:**
- Ouvrir DevTools sur Chess.com
- Console > Filtrer "WebSocket" ou "Stockfish"

---

### Erreur "EPIPE" ou "Engine crashed"

**Cause:** Le processus Stockfish s'est fermé inopinément

**Solution:**
```bash
# Le pool redémarre automatiquement le moteur
# Si ça persiste, redéployer:
./deploy-server.sh
```

---

### Le conteneur Docker ne démarre pas

```bash
# 1. Voir les logs Docker
./ssh-connect.sh "sudo docker logs chess-stockfish-server"

# 2. Voir tous les conteneurs
./ssh-connect.sh "sudo docker ps -a"

# 3. Nettoyer Docker et rebuild
./ssh-connect.sh "sudo docker system prune -af"
./deploy-server.sh
```

---

### Manque d'espace disque

```bash
# 1. Vérifier l'espace
./ssh-connect.sh "df -h"

# 2. Nettoyer Docker
./ssh-connect.sh "sudo docker system prune -af --volumes"

# 3. Nettoyer les logs
./ssh-connect.sh "sudo journalctl --vacuum-time=7d"
```

---

## 📊 Monitoring Production

### Stats en temps réel

```bash
# Terminal 1: Logs en continu
./follow-remote-logs.sh

# Terminal 2: Stats CPU/RAM toutes les 5s
watch -n 5 './ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"'
```

---

### Métriques serveur

```bash
# Utilisation CPU/RAM
./ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"

# Nombre de connexions actives
./view-remote-logs.sh | grep "Client connected" | wc -l

# Analyses par minute (approximatif)
./view-remote-logs.sh 100 | grep "Starting analysis" | wc -l
```

---

### Health Check

Le serveur expose un health check Docker:
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('ws')"]
  interval: 30s
  timeout: 10s
  retries: 3
```

**Vérification:**
```bash
./ssh-connect.sh "sudo docker inspect chess-stockfish-server | grep -A 10 Health"
```

---

## 📖 Documentation Complémentaire

| Document | Description |
|----------|-------------|
| [SERVEUR_INFO.md](SERVEUR_INFO.md) | Infos serveur et API WebSocket |
| [SERVER_SCRIPTS.md](SERVER_SCRIPTS.md) | Guide détaillé des scripts |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Guide de déploiement initial |
| [DEPLOYMENT_DOCKER.md](DEPLOYMENT_DOCKER.md) | Configuration Docker |
| [SSH_SETUP.md](SSH_SETUP.md) | Configuration SSH |
| [DOMAIN_SETUP.md](DOMAIN_SETUP.md) | Configuration DNS et domaines |
| [SSL_CONFIGURED.md](SSL_CONFIGURED.md) | Configuration SSL/TLS |
| [QUICK_START.md](QUICK_START.md) | Démarrage rapide |
| [README.md](README.md) | Vue d'ensemble du projet |

---

## 🔧 Configuration Avancée

### Variables d'environnement (Serveur)

Le serveur n'utilise pas de fichier `.env` pour l'instant. Configuration hardcodée dans:
- `server/src/index.ts` (port, pool config)
- `server/src/stockfish-pool.ts` (moteurs, threads, hash)

### Configuration Nginx

```bash
# Voir la config
./ssh-connect.sh "cat /etc/nginx/sites-available/chessr.io"

# Tester la config
./ssh-connect.sh "sudo nginx -t"

# Recharger Nginx
./ssh-connect.sh "sudo systemctl reload nginx"
```

---

## 📝 Notes Importantes

- **Mot de passe dans les scripts:** Les scripts utilisent `expect` avec le mot de passe en clair. À sécuriser pour production (clé SSH uniquement).
- **Logs limités:** Docker logs limités à 10MB × 3 fichiers max
- **Auto-restart:** Le conteneur redémarre automatiquement (`restart: unless-stopped`)
- **Pool auto-scaling:** Min 2 moteurs, max 8 moteurs selon la charge
- **Timeout analyses:** Analyses automatiquement annulées après timeout (moveTime + 5s)

---

## 🎯 Checklist Déploiement Production

- [x] Serveur VPS configuré
- [x] Docker installé et opérationnel
- [x] Stockfish installé dans le conteneur
- [x] Firewall UFW configuré (ports 22, 80, 443, 3000)
- [x] SSH sécurisé avec clé
- [x] Domaines configurés (chessr.io, ws.chessr.io)
- [x] SSL/TLS Let's Encrypt actif
- [x] Nginx reverse proxy configuré
- [x] Pool de moteurs Stockfish opérationnel
- [x] Timeout sur les analyses implémenté
- [x] Health checks Docker configurés
- [x] Tests de connexion validés
- [x] Scripts de gestion opérationnels

---

## 🆘 Support et Contact

En cas de problème non résolu par cette documentation:

1. Vérifier les logs: `./follow-remote-logs.sh`
2. Tester la connexion: `node test-remote-debug.js`
3. Vérifier le statut: `./check-server-status.sh`
4. Redémarrer si nécessaire: `./restart-remote-server.sh`

---

**📌 Dernière mise à jour:** 2026-01-24
**🔧 Maintenu par:** Timothe
**🚀 Version serveur:** 1.0.0 (avec timeout fix)
