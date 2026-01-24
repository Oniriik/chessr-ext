# Déploiement avec Docker

Guide pour déployer le serveur Chess Stockfish avec Docker et Docker Compose sur un VPS.

## Prérequis

- Un VPS avec Docker et Docker Compose installés
- Accès SSH au VPS

## Installation de Docker sur le VPS

```bash
# Connexion au VPS
ssh root@votre-ip-vps

# Installation de Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Installation de Docker Compose
apt install -y docker-compose-plugin

# Vérification
docker --version
docker compose version

# (Optionnel) Ajouter votre utilisateur au groupe docker
usermod -aG docker $USER
```

## Déploiement

### 1. Transfert des fichiers

Depuis votre machine locale :

```bash
cd /Users/timothe/dev/chess

# Transfert via rsync
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  ./ root@votre-ip-vps:/opt/chess-server/
```

### 2. Build et démarrage

Sur le VPS :

```bash
cd /opt/chess-server

# Build de l'image
docker compose build

# Démarrage du serveur
docker compose up -d

# Vérification des logs
docker compose logs -f chess-server
```

### 3. Vérification

```bash
# Vérifier que le conteneur tourne
docker compose ps

# Tester la connexion
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" \
  http://localhost:3000
```

## Avec Nginx (Reverse Proxy)

### 1. Créer la configuration Nginx

```bash
mkdir -p nginx
nano nginx/nginx.conf
```

Contenu :

```nginx
events {
    worker_connections 1024;
}

http {
    upstream chess_backend {
        server chess-server:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=chessapi:10m rate=20r/s;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    server {
        listen 80;
        server_name votre-domaine.com;

        location / {
            limit_req zone=chessapi burst=50 nodelay;

            proxy_pass http://chess_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }

        location /health {
            proxy_pass http://chess_backend/health;
            access_log off;
        }
    }
}
```

### 2. Démarrer avec Nginx

```bash
# Démarrer avec le profil nginx
docker compose --profile with-nginx up -d

# Vérifier
docker compose ps
```

### 3. Ajouter SSL avec Certbot

```bash
# Installer certbot sur le host
apt install -y certbot

# Arrêter temporairement nginx
docker compose stop nginx

# Obtenir le certificat
certbot certonly --standalone -d votre-domaine.com

# Créer le répertoire SSL
mkdir -p nginx/ssl

# Copier les certificats
cp /etc/letsencrypt/live/votre-domaine.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/votre-domaine.com/privkey.pem nginx/ssl/

# Modifier nginx.conf pour ajouter SSL
nano nginx/nginx.conf
```

Ajouter la configuration SSL :

```nginx
server {
    listen 443 ssl http2;
    server_name votre-domaine.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # ... reste de la configuration
}

server {
    listen 80;
    server_name votre-domaine.com;
    return 301 https://$server_name$request_uri;
}
```

Redémarrer :

```bash
docker compose --profile with-nginx up -d
```

## Commandes Utiles

```bash
# Voir les logs
docker compose logs -f chess-server

# Redémarrer
docker compose restart chess-server

# Arrêter
docker compose down

# Rebuild après modification du code
docker compose build
docker compose up -d

# Voir l'utilisation des ressources
docker stats

# Entrer dans le conteneur
docker compose exec chess-server sh

# Nettoyer les images inutilisées
docker system prune -a
```

## Mise à Jour

```bash
# Sur votre machine locale
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ root@votre-ip-vps:/opt/chess-server/

# Sur le VPS
cd /opt/chess-server
docker compose build
docker compose up -d
```

## Monitoring et Logs

### Voir tous les logs

```bash
docker compose logs -f
```

### Logs d'un service spécifique

```bash
docker compose logs -f chess-server
docker compose logs -f nginx
```

### Statistiques en temps réel

```bash
docker stats
```

## Sauvegarde et Restauration

### Sauvegarder l'image

```bash
docker save chess-server:latest | gzip > chess-server-backup.tar.gz
```

### Restaurer l'image

```bash
gunzip -c chess-server-backup.tar.gz | docker load
```

## Configuration du Firewall

```bash
# Si UFW est installé
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp  # Si pas de Nginx
ufw enable
```

## Dépannage

### Le conteneur ne démarre pas

```bash
docker compose logs chess-server
docker compose ps -a
```

### Stockfish non trouvé

Vérifier qu'il est installé dans l'image :

```bash
docker compose exec chess-server which stockfish
docker compose exec chess-server stockfish --version
```

### Problèmes de réseau

```bash
docker network ls
docker network inspect chess-network
```

### Rebuild complet

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Optimisation des Performances

### Ajuster les ressources

Modifier `docker-compose.yml` :

```yaml
deploy:
  resources:
    limits:
      cpus: '4'      # Plus de CPUs
      memory: 4G     # Plus de mémoire
```

### Augmenter la capacité Stockfish

Modifier `server/src/index.ts` avant le build :

```typescript
const POOL_CONFIG = {
  minEngines: 4,
  maxEngines: 16,
  threads: 4,
  hash: 256,
};
```

Rebuild :

```bash
docker compose build
docker compose up -d
```

## Avantages de Docker

✅ Installation simple et rapide
✅ Isolation complète
✅ Reproductibilité garantie
✅ Facile à mettre à jour
✅ Portabilité entre environnements
✅ Gestion des ressources
✅ Rollback facile en cas de problème

## Comparaison avec Installation Classique

| Aspect | Docker | Installation Classique |
|--------|--------|----------------------|
| Installation | Plus rapide | Plus longue |
| Isolation | Excellente | Moyenne |
| Mises à jour | Très simple | Modérée |
| Ressources | Overhead minimal | Natif |
| Debugging | Plus difficile | Plus facile |
| Portabilité | Excellente | Dépend de l'OS |
