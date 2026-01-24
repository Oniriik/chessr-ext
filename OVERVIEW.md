# 📊 ChessR - Vue d'Ensemble

Aperçu rapide du projet en une page.

---

## 🎯 Qu'est-ce que ChessR ?

Extension Chrome d'analyse d'échecs en temps réel pour Chess.com et Lichess.org, alimentée par Stockfish via un serveur WebSocket.

---

## 🏗️ Architecture

```
UTILISATEUR (Chess.com / Lichess)
         │
         ▼
   EXTENSION CHROME ──────► React + TypeScript + Tailwind
         │
         │ WebSocket (wss://ws.chessr.io)
         ▼
   NGINX REVERSE PROXY ───► SSL/TLS Let's Encrypt
         │
         ▼
   SERVEUR NODE.JS ───────► Pool 2-8 moteurs Stockfish
         │
         ▼
   STOCKFISH 16.1 ────────► Analyse UCI
```

---

## 🔐 Accès Serveur

| Info | Valeur |
|------|--------|
| **IP** | 135.125.201.246 |
| **SSH** | ubuntu@135.125.201.246 |
| **Mot de passe** | Chess2026SecurePass! |
| **WebSocket** | wss://ws.chessr.io |

---

## 🚀 Commandes Essentielles

```bash
./deploy-server.sh          # Déployer une mise à jour
./restart-remote-server.sh  # Redémarrer le serveur
./check-server-status.sh    # Vérifier l'état
./view-remote-logs.sh       # Voir les logs
./follow-remote-logs.sh     # Logs en temps réel
./ssh-connect.sh            # Connexion SSH
node test-remote-debug.js   # Tester la connexion
```

---

## 📁 Structure

```
chess/
├── server/          # Serveur Stockfish (Node.js + TypeScript)
├── extension/       # Extension Chrome (React + TypeScript)
├── landing/         # Site vitrine (Next.js)
├── nginx/           # Config reverse proxy
├── *.sh             # Scripts de gestion
└── *.md             # Documentation
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [DOCUMENTATION.md](DOCUMENTATION.md) | Documentation complète |
| [CHEATSHEET.md](CHEATSHEET.md) | Aide-mémoire commandes |
| [INDEX.md](INDEX.md) | Index de navigation |
| [SERVER_SCRIPTS.md](SERVER_SCRIPTS.md) | Guide des scripts |
| [SERVEUR_INFO.md](SERVEUR_INFO.md) | Identifiants serveur |

---

**Dernière mise à jour:** 2026-01-24
