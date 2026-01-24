# ChessR - Extension d'Analyse d'Échecs

Extension Chrome avec serveur Stockfish WebSocket pour l'analyse d'échecs en temps réel sur Chess.com et Lichess.org.

## 🚀 Accès Rapide

| Document | Description | Utilisation |
|----------|-------------|-------------|
| **[INDEX.md](INDEX.md)** | 📑 **Index de tous les documents** | Navigation |
| **[DOCUMENTATION.md](DOCUMENTATION.md)** | 📖 **Documentation complète** | Référence principale |
| **[CHEATSHEET.md](CHEATSHEET.md)** | 📝 **Aide-mémoire commandes** | Usage quotidien |
| [SERVER_SCRIPTS.md](SERVER_SCRIPTS.md) | 🛠️ Guide des scripts | Gestion serveur |
| [QUICK_START.md](QUICK_START.md) | ⚡ Démarrage rapide | Installation |

---

## 🔐 Identifiants Serveur

| Information | Valeur |
|-------------|--------|
| **Serveur** | vps-8058cb7f.vps.ovh.net |
| **IP** | 135.125.201.246 |
| **Utilisateur** | ubuntu |
| **Mot de passe** | Chess2026SecurePass! |
| **WebSocket Production** | wss://ws.chessr.io |
| **WebSocket Direct** | ws://135.125.201.246:3000 |

**Connexion rapide:**
```bash
./ssh-connect.sh                    # Connexion interactive
./ssh-connect.sh "sudo docker ps"   # Exécuter une commande
```

---

## 📚 Documentation

### Documentation Centrale

| Document | Description |
|----------|-------------|
| **[DOCUMENTATION.md](DOCUMENTATION.md)** | **📖 Documentation complète du projet** (architecture, identifiants, scripts, codebase) |
| [SERVER_SCRIPTS.md](SERVER_SCRIPTS.md) | 🛠️ Guide des scripts de gestion serveur |
| [SERVEUR_INFO.md](SERVEUR_INFO.md) | 🔐 Identifiants et accès serveur |

### Guides d'Installation

| Guide | Description | Pour qui ? |
|-------|-------------|-----------|
| [QUICK_START.md](QUICK_START.md) | Démarrage express (< 5 min) | Débutants, installation rapide |
| [DEPLOYMENT_DOCKER.md](DEPLOYMENT_DOCKER.md) | Installation avec Docker | Recommandé pour la plupart |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Installation classique | Performances maximales |
| [DOMAIN_SETUP.md](DOMAIN_SETUP.md) | Configuration DNS et domaines | Configuration production |
| [SSL_CONFIGURED.md](SSL_CONFIGURED.md) | Configuration SSL/TLS | Sécurisation HTTPS |

## 🛠️ Structure du Projet

```
chess/
├── 📄 README.md                    # Ce fichier
├── 📘 QUICK_START.md               # Guide de démarrage rapide
├── 📘 DEPLOYMENT.md                # Guide installation classique
├── 📘 DEPLOYMENT_DOCKER.md         # Guide installation Docker
├── 🐳 docker-compose.yml           # Configuration Docker Compose
│
├── 🖥️ server/                      # Code du serveur
│   ├── 📄 README.md                # Documentation API
│   ├── 📦 package.json
│   ├── 🐳 Dockerfile               # Image Docker
│   ├── 📁 src/                     # Code source TypeScript
│   │   ├── index.ts                # Serveur WebSocket
│   │   ├── stockfish-pool.ts       # Pool avec auto-scaling
│   │   ├── stockfish.ts            # Wrapper Stockfish
│   │   ├── move-selector.ts        # Sélection de coups
│   │   └── types.ts                # Types TypeScript
│   └── 📁 dist/                    # Code compilé (après build)
│
├── 🔧 scripts/                     # Scripts d'installation
│   ├── 📄 README.md                # Documentation scripts
│   ├── 📜 install-vps.sh           # Installation VPS auto
│   ├── 📜 deploy.sh                # Déploiement application
│   ├── 📜 setup-nginx.sh           # Configuration Nginx
│   └── 📜 test-server.sh           # Tests automatiques
│
├── 🌐 nginx/                       # Configuration Nginx
│   ├── 📄 README.md                # Documentation Nginx
│   ├── ⚙️ nginx.conf               # Configuration complète
│   └── 📁 ssl/                     # Certificats SSL (à créer)
│
└── 🔌 extension/                   # Extension Chrome (séparée)
```

## ⚡ Installation Rapide

### Option 1 : Docker (Recommandé)

```bash
# Sur votre VPS
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Transfert des fichiers
rsync -avz chess/ root@votre-ip:/opt/chess-server/

# Démarrage
cd /opt/chess-server
docker compose up -d
```

### Option 2 : Installation Classique

```bash
# Installation automatique
ssh root@votre-ip
curl -fsSL https://votre-url/scripts/install-vps.sh | bash

# Transfert et déploiement
rsync -avz server/ root@votre-ip:/opt/chess-server/
ssh root@votre-ip "cd /opt/chess-server && bash scripts/deploy.sh"
```

## 🧪 Test de Connexion

```bash
# Installation de wscat
npm install -g wscat

# Test
wscat -c ws://votre-ip:3000

# Ou avec le script
bash scripts/test-server.sh votre-ip 3000
```

## 🎯 Fonctionnalités

- ✅ Pool de moteurs Stockfish avec auto-scaling (2-8 moteurs)
- ✅ WebSocket API simple et performante
- ✅ Support multi-connexions simultanées
- ✅ Différents modes de jeu (balanced, aggressive, positional)
- ✅ Ajustement du niveau ELO (500-3000)
- ✅ Analyse multi-PV (plusieurs variations)
- ✅ Déploiement facile avec Docker ou PM2
- ✅ Rate limiting et sécurité intégrés

## 📊 API WebSocket

### Connexion

```javascript
const ws = new WebSocket('ws://votre-serveur:3000');
```

### Analyse de position

```javascript
ws.send(JSON.stringify({
  type: 'analyze',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  searchMode: 'depth',  // ou 'time'
  depth: 20,
  multiPV: 3,
  elo: 2000,
  mode: 'balanced'
}));
```

Voir [server/README.md](server/README.md) pour la documentation complète de l'API.

## 🔧 Scripts de Gestion Serveur

**Voir [SERVER_SCRIPTS.md](SERVER_SCRIPTS.md) pour le guide complet**

| Script | Description | Usage |
|--------|-------------|-------|
| `./deploy-server.sh` | Déploie une nouvelle version du serveur | Après modification du code |
| `./restart-remote-server.sh` | Redémarre le serveur Docker | Serveur bloqué |
| `./check-server-status.sh` | Vérifie l'état complet du serveur | Diagnostic |
| `./view-remote-logs.sh [lignes]` | Affiche les derniers logs | Debug |
| `./follow-remote-logs.sh` | Suit les logs en temps réel | Monitoring |
| `./ssh-connect.sh [cmd]` | Connexion SSH ou exécution commande | Accès serveur |

### Scripts de Test

| Script | Description |
|--------|-------------|
| `node test-remote-server.js` | Test simple de connexion |
| `node test-remote-debug.js` | Test détaillé avec tous les messages |
| `./test-connection.sh` | Test bash avec wscat |

## 🐳 Commandes Docker

```bash
# Démarrage
docker compose up -d

# Logs
docker compose logs -f

# Redémarrage
docker compose restart

# Arrêt
docker compose down
```

## 🔄 Commandes PM2

```bash
# Logs
pm2 logs chess-stockfish-server

# Redémarrage
pm2 restart chess-stockfish-server

# Monitoring
pm2 monit
```

## 🔐 Sécurité

Les configurations incluent :
- 🔥 Firewall (UFW)
- 🚦 Rate limiting
- 👤 Utilisateur non-root
- 🔒 SSL/TLS (optionnel)
- 🐳 Isolation (Docker)

## 📈 Performance

Sur un VPS 4 CPU / 8 GB RAM :
- **Connexions simultanées** : 50+
- **Analyses/seconde** : 20+
- **Profondeur moyenne (1s)** : 18-22 coups
- **Nœuds/seconde** : 500k-2M par moteur

## 🆘 Aide et Dépannage

1. Consultez [QUICK_START.md](QUICK_START.md)
2. Vérifiez les logs :
   - Docker : `docker compose logs -f`
   - PM2 : `pm2 logs chess-stockfish-server`
3. Utilisez le script de test : `bash scripts/test-server.sh`
4. Consultez les guides détaillés selon votre méthode d'installation

## 📝 Licence

MIT

---

**🎉 Prêt à commencer ?** → [QUICK_START.md](QUICK_START.md)
