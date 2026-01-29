# Dashboard Chessr - Documentation

## Vue d'ensemble

Le dashboard Chessr est une application web Next.js qui permet de :
- Gérer et monitorer le serveur d'analyse d'échecs
- Visualiser les métriques en temps réel
- Administrer les utilisateurs et permissions
- Contrôler les containers Docker (start/stop/restart)

## Architecture

### Stack Technique

- **Framework** : Next.js 14+ (App Router)
- **Runtime** : Node.js 20
- **Base de données** : Supabase (PostgreSQL)
- **Authentification** : Supabase Auth
- **Monitoring** : Grafana Cloud
- **UI** : React + Tailwind CSS

### Déploiement

**URL** : https://dashboard.chessr.io

**Container Docker** :
- **Nom** : `chess-dashboard`
- **Image** : `app-dashboard` (build local)
- **Port** : `3000` (interne et exposé)
- **Ressources** :
  - CPU : Limité à 0.5 vCPU
  - RAM : Limité à 512 MB

## Configuration

### Variables d'environnement

```bash
# Production
NODE_ENV=production

# Supabase (base de données et auth)
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# WebSocket serveur d'analyse
NEXT_PUBLIC_CHESS_SERVER_URL=wss://engine.chessr.io

# Administration
ADMIN_EMAILS=email1@example.com,email2@example.com

# Monitoring
METRICS_URL=http://chess-engine:3001/metrics

# Docker control
DOCKER_CONTAINER_NAME=chess-engine
```

### Permissions Docker

Le dashboard a accès en lecture au socket Docker pour contrôler le container `chess-engine` :
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

Cela permet de :
- Voir l'état du container engine
- Redémarrer le service si nécessaire
- Récupérer les logs en temps réel

## Fonctionnalités

### 1. Authentification
- Login via Supabase Auth
- Restriction par liste d'emails autorisés (`ADMIN_EMAILS`)
- Session persistante

### 2. Monitoring
- **Métriques Engine** : Via endpoint `http://chess-engine:3001/metrics`
- **État Container** : Via Docker API
- **Graphiques temps réel** : Grafana Cloud

### 3. Gestion Container
- Voir l'état (running/stopped/unhealthy)
- Redémarrer le service
- Consulter les logs

### 4. Analyse des Tests
- Visualisation des résultats de tests d'analyse
- Statistiques de performance du moteur
- Historique des parties analysées

## Développement

### Structure du projet

```
dashboard/
├── app/               # Next.js App Router
│   ├── page.tsx      # Page d'accueil
│   ├── login/        # Authentification
│   └── api/          # API routes
├── components/        # Composants React
├── lib/              # Utilitaires
├── public/           # Assets statiques
└── Dockerfile        # Image production
```

### Build local

```bash
cd dashboard
npm install
npm run dev      # Développement sur http://localhost:3000
npm run build    # Build production
npm start        # Serveur production
```

### Build Docker

```bash
cd /opt/chessr/app
docker compose build dashboard
docker compose up -d dashboard
```

## Reverse Proxy (Nginx)

**Configuration** : `/opt/chessr/nginx/dashboard.chessr.io.conf`

```nginx
server {
    server_name dashboard.chessr.io;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/dashboard.chessr.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.chessr.io/privkey.pem;
}
```

## Logs

### Logs Container

```bash
# Temps réel
docker logs chess-dashboard -f

# Dernières 100 lignes
docker logs chess-dashboard --tail 100

# Avec timestamps
docker logs chess-dashboard -f --timestamps
```

### Logs Nginx

```bash
# Access logs
tail -f /opt/chessr/logs/dashboard-access.log

# Error logs
tail -f /opt/chessr/logs/dashboard-error.log
```

## Commandes Utiles

### Redémarrage

```bash
cd /opt/chessr/app
docker compose restart chess-dashboard
```

### Mise à jour

```bash
cd /opt/chessr/app
git pull origin master
docker compose build dashboard
docker compose up -d dashboard
```

### Health Check

```bash
# Vérifier l'état
docker inspect chess-dashboard | grep -A5 Health

# Test HTTP
curl http://localhost:3000
```

### Variables d'environnement

```bash
# Voir toutes les variables
docker exec chess-dashboard env | grep -E "NEXT_PUBLIC|ADMIN|NODE_ENV"
```

## Troubleshooting

### Dashboard inaccessible

1. Vérifier que le container est running :
   ```bash
   docker ps | grep chess-dashboard
   ```

2. Vérifier les logs :
   ```bash
   docker logs chess-dashboard --tail 50
   ```

3. Vérifier le port 3000 :
   ```bash
   ss -tlnp | grep 3000
   ```

4. Redémarrer si nécessaire :
   ```bash
   docker compose restart chess-dashboard
   ```

### Erreurs "Server Action"

Problème connu avec le cache Next.js. Solution :
```bash
docker compose down dashboard
docker compose up -d dashboard
```

### Impossible de contrôler le container engine

Vérifier les permissions Docker socket :
```bash
docker exec chess-dashboard ls -l /var/run/docker.sock
```

## Sécurité

### Accès Restreint
- Authentification obligatoire via Supabase
- Liste blanche d'emails administrateurs
- Pas d'accès public

### SSL/TLS
- Certificat Let's Encrypt (ECDSA)
- HTTPS forcé (redirection HTTP → HTTPS)
- Renouvellement automatique

### Docker Socket
- Monté en **lecture seule** (`:ro`)
- Accès limité au contrôle du container `chess-engine`

## Métriques & Monitoring

### Endpoints

- **Dashboard** : https://dashboard.chessr.io
- **Engine Metrics** : http://chess-engine:3001/metrics (interne)
- **Grafana** : Configuré via variables d'environnement

### Health Check

Le container expose un health check HTTP sur le port 3000 :
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
  interval: 30s
  timeout: 3s
  retries: 3
  start_period: 10s
```

## Dépendances

- **chess-engine** : Le dashboard dépend du container engine pour :
  - Récupérer les métriques
  - Contrôler le service
  - Visualiser les analyses

- **Supabase** : Requis pour l'authentification et la base de données

- **Docker socket** : Nécessaire pour le contrôle des containers
