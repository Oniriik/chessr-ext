# Déploiement Serveur Chessr

## État Actuel du Déploiement

**Date de déploiement** : 2026-01-28
**Serveur** : 91.99.78.172 (Hetzner Cloud x86_64)

## Services Déployés

### Containers Docker

| Container | Image | Ports | Status | Description |
|-----------|-------|-------|--------|-------------|
| `chess-engine` | app-chess-engine | 8080:3000, 8081:3001 | Up 3h (unhealthy) | Serveur WebSocket Komodo Dragon |
| `chess-dashboard` | app-dashboard | 3000:3000 | Up 3h (healthy) | Dashboard admin Next.js |

### Configuration Engine (chess-engine)

**Ports exposés** :
- `8080` → WebSocket principal (accessible via engine.chessr.io)
- `8081` → Endpoint métriques

**Moteur d'échecs** :
- Komodo Dragon 3.3
- Binaire : `dragon-3.3-linux-avx2` (optimisé AVX2)
- Pool d'engines configuré
- Personnalités supportées

**Variables d'environnement** :
- `NODE_ENV=production`
- `PORT=3000`
- `ENGINE_PATH=/engine/dragon-3.3-linux-avx2`
- `SUPABASE_JWT_SECRET`
- `GRAFANA_INSTANCE_ID`, `GRAFANA_API_KEY`, `GRAFANA_REMOTE_WRITE_URL`
- `POOL_MIN_ENGINES`, `POOL_MAX_ENGINES`
- `ENGINE_THREADS`, `ENGINE_HASH`

**Ressources** :
- CPU : Limité à 2 vCPU, réservé 1 vCPU
- RAM : Limité à 2 GB, réservé 512 MB

### Configuration Dashboard (chess-dashboard)

**Port exposé** :
- `3000` → Application web (accessible via dashboard.chessr.io)

**URL WebSocket** :
- `NEXT_PUBLIC_CHESS_SERVER_URL=wss://engine.chessr.io`

**Variables d'environnement** :
- `NODE_ENV=production`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ADMIN_EMAILS`
- `METRICS_URL=http://chess-engine:3001/metrics`
- `DOCKER_CONTAINER_NAME=chess-engine`

**Ressources** :
- CPU : Limité à 0.5 vCPU
- RAM : Limité à 512 MB

**Accès Docker** :
- Mount du socket Docker (`/var/run/docker.sock`) pour contrôle des containers

## Reverse Proxy Nginx

### Configuration

**Domaines** :
- `dashboard.chessr.io` → `localhost:3000` (dashboard)
- `engine.chessr.io` → `localhost:8080` (engine WebSocket)

**SSL/TLS** :
- Certificats Let's Encrypt ECDSA
- Renouvellement automatique
- Expiration : 2026-04-28

**Fichiers de configuration** :
- `/opt/chessr/nginx/dashboard.chessr.io.conf`
- `/opt/chessr/nginx/engine.chessr.io.conf`

### Logs

**Nginx** :
- `/opt/chessr/logs/dashboard-access.log`
- `/opt/chessr/logs/dashboard-error.log`
- `/opt/chessr/logs/engine-access.log`
- `/opt/chessr/logs/engine-error.log`

**Containers** :
```bash
docker logs chess-engine -f
docker logs chess-dashboard -f
```

## Fichiers de Configuration

### Localisation

```
/opt/chessr/app/
├── .env                    # Variables d'environnement (production)
├── .env.example            # Template variables
├── docker-compose.yml      # Configuration containers
├── server/
│   ├── Dockerfile          # Image Node.js (node:20-slim)
│   └── engine/Linux/       # Binaires Komodo Dragon
│       ├── dragon-3.3-linux
│       └── dragon-3.3-linux-avx2
└── dashboard/
    └── Dockerfile          # Image Next.js
```

### Variables d'environnement (.env)

Fichier `.env` créé le 2026-01-28 avec :
- Credentials Supabase
- Tokens Grafana
- Configuration pool engines
- Emails admin

## Commandes de Gestion

### Redémarrer les services

```bash
cd /opt/chessr/app
docker compose restart chess-engine
docker compose restart chess-dashboard
```

### Mettre à jour depuis GitHub

```bash
cd /opt/chessr/app
git pull origin master
docker compose build
docker compose up -d
```

### Voir les logs

```bash
# Logs en temps réel
docker logs chess-engine -f --tail 100
docker logs chess-dashboard -f --tail 100

# Logs Nginx
tail -f /opt/chessr/logs/engine-access.log
tail -f /opt/chessr/logs/dashboard-access.log
```

### Vérifier l'état

```bash
# Containers
docker ps -a
docker compose ps

# Ports
ss -tlnp | grep -E ':3000|:8080'

# Health checks
docker inspect chess-engine | grep -A5 Health
docker inspect chess-dashboard | grep -A5 Health
```

## Réseau Docker

**Network** : `chess-network`

Communication inter-containers :
- Dashboard → Engine : `http://chess-engine:3001/metrics`
- Dashboard contrôle Engine via Docker socket

## Notes de Déploiement

### Problèmes résolus

1. **Architecture incompatible** : Serveur rebuild de ARM64 vers x86_64
2. **Alpine → Debian** : Dockerfile changé pour compatibilité glibc
3. **Ports alignés** : Engine sur 8080, Dashboard sur 3000
4. **Optimisation AVX2** : Utilisation de dragon-3.3-linux-avx2

### État actuel

- ✅ Engine fonctionne et traite des analyses
- ✅ Dashboard accessible et healthy
- ⚠️ Engine marqué unhealthy (mais fonctionnel - à investiguer)
- ⚠️ Dashboard erreurs "Server Action" (probablement cache Next.js)

### Prochaines actions suggérées

1. Investiguer pourquoi chess-engine est marqué unhealthy
2. Vérifier endpoint métriques (port 3001)
3. Nettoyer cache Next.js si erreurs persistent

## Monitoring

### Accès

- **Engine** : https://engine.chessr.io
- **Dashboard** : https://dashboard.chessr.io

### Métriques Grafana

- Instance ID configurée
- Remote write activé
- Endpoint : `http://chess-engine:3001/metrics`

## Backup

**Emplacement** : `/opt/chessr/backups/`

Pour backup manuel :
```bash
# Backup .env
cp /opt/chessr/app/.env /opt/chessr/backups/.env.$(date +%Y%m%d)

# Backup logs
tar -czf /opt/chessr/backups/logs-$(date +%Y%m%d).tar.gz /opt/chessr/logs/
```
