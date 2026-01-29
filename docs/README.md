# Documentation Chessr

Documentation complète du projet Chessr, organisée par composants.

## Aperçu Général

Chessr est une plateforme d'analyse d'échecs comprenant :
- **Extension navigateur** : Intégration avec Chess.com et Lichess pour analyser les parties en temps réel
- **Serveur d'analyse** : WebSocket serveur avec moteur Komodo Dragon 3.3 pour l'analyse des positions
- **Dashboard admin** : Interface web Next.js pour la gestion et le monitoring

### Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│                    Hetzner Cloud Server                      │
│                   91.99.78.172 (Ubuntu 24.04)                │
│                   8 vCPU / 16 GB RAM / 301 GB                │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Nginx (SSL)     │
                    │   Reverse Proxy   │
                    └─────────┬─────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
    │ dashboard│      │   engine    │     │  download   │
    │.chessr.io│      │.chessr.io   │     │.chessr.io   │
    │ (HTTPS)  │      │  (WSS)      │     │  (HTTPS)    │
    └────┬─────┘      └──────┬──────┘     └──────┬──────┘
         │                   │                    │
    ┌────▼─────┐      ┌─────▼──────┐      ┌─────▼──────┐
    │Dashboard │      │   Engine   │      │ Extension  │
    │Container │◄─────┤ Container  │      │  Fichiers  │
    │Next.js   │      │  Node.js   │      │  Statiques │
    │:3000     │      │:8080 :8081 │      │   (.zip)   │
    └──────────┘      └────────────┘      └────────────┘
         │                   │
         │      Docker Network (chess-network)
         └───────────────────┘
```

**Flux de données** :
1. **Utilisateur → Extension** : Analyse parties sur Chess.com/Lichess
2. **Extension → Engine** : WebSocket vers `wss://engine.chessr.io`
3. **Engine → Komodo Dragon** : Traitement UCI des positions d'échecs
4. **Dashboard** : Monitoring metrics, contrôle containers, gestion utilisateurs

### Domaines et SSL

| Domaine | Fonction | Backend | SSL |
|---------|----------|---------|-----|
| `dashboard.chessr.io` | Dashboard admin Next.js | `localhost:3000` | ✅ Let's Encrypt |
| `engine.chessr.io` | WebSocket serveur d'analyse | `localhost:8080` | ✅ Let's Encrypt |
| `download.chessr.io` | Distribution extension (.zip) | `/opt/chessr/extension` | ✅ Let's Encrypt |

**Renouvellement SSL** : Automatique via Certbot (expiration: 2026-04-28)

## Structure

### 📁 [server/](./server/)
Documentation relative au serveur de production :
- Configuration serveur
- Déploiement
- Maintenance
- Monitoring

### 📁 [dashboard/](./dashboard/)
Documentation du dashboard web :
- Architecture
- Configuration
- API endpoints
- Déploiement

### 📁 [extension/](./extension/)
Documentation de l'extension navigateur :
- Installation
- Configuration
- Architecture
- Build & Release

## Documents Principaux

### Serveur
- [Informations Serveur](./server/SERVER_INFO.md) - Spécifications, accès SSH, ressources
- [Configuration Nginx](./server/NGINX_CONFIG.md) - Reverse proxy, SSL, domaines
- [Configuration Komodo Dragon](./server/KOMODO_CONFIG.md) - Moteur d'échecs, compatibilité, optimisations
- [Déploiement](./server/DEPLOYMENT.md) - État actuel, containers, commandes de gestion

## Convention

- Tous les fichiers de documentation sont en Markdown (.md)
- Les commandes shell sont dans des blocs de code
- Les informations sensibles (mots de passe, tokens) ne sont jamais commitées
