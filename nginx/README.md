# Configuration Nginx

Configuration Nginx pour le serveur Chess Stockfish.

## Utilisation avec Docker

Le fichier `nginx.conf` est configuré pour Docker Compose.

### Démarrage

```bash
docker compose --profile with-nginx up -d
```

### Configuration SSL

```bash
# Obtenir le certificat
certbot certonly --standalone -d votre-domaine.com

# Créer le répertoire SSL
mkdir -p ssl

# Copier les certificats
cp /etc/letsencrypt/live/votre-domaine.com/fullchain.pem ssl/
cp /etc/letsencrypt/live/votre-domaine.com/privkey.pem ssl/

# Décommenter la section HTTPS dans nginx.conf
nano nginx.conf

# Redémarrer
docker compose --profile with-nginx restart
```

## Utilisation avec Installation Classique

### Installation

```bash
# Copier la configuration
sudo cp nginx.conf /etc/nginx/sites-available/chess-server

# Modifier l'upstream dans nginx.conf
# Remplacer : server chess-server:3000;
# Par :       server localhost:3000;

# Activer
sudo ln -s /etc/nginx/sites-available/chess-server /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Configuration SSL avec Certbot

```bash
sudo certbot --nginx -d votre-domaine.com
```

## Configuration

### Variables à modifier

Dans `nginx.conf`, changez :

1. **server_name** : Remplacez `votre-domaine.com` par votre domaine
2. **upstream** :
   - Docker : `server chess-server:3000;`
   - Classique : `server localhost:3000;`
3. **Certificats SSL** : Vérifiez les chemins dans la section HTTPS

### Rate Limiting

Par défaut : 20 requêtes/seconde avec burst de 50.

Pour modifier :

```nginx
limit_req_zone $binary_remote_addr zone=chessapi:10m rate=50r/s;  # 50 req/s
```

### Timeouts WebSocket

Par défaut : 24 heures (86400 secondes).

Pour modifier :

```nginx
proxy_read_timeout 3600s;  # 1 heure
proxy_send_timeout 3600s;
```

## Test

```bash
# Vérifier la configuration
sudo nginx -t

# Recharger Nginx
sudo systemctl reload nginx

# Vérifier les logs
sudo tail -f /var/log/nginx/chess-error.log
```

## Dépannage

### 502 Bad Gateway

Le serveur backend n'est pas accessible.

```bash
# Vérifier que le serveur tourne
docker compose ps  # Docker
pm2 status         # PM2

# Vérifier la connectivité
curl http://localhost:3000
```

### WebSocket connection failed

```nginx
# Vérifier que ces lignes sont présentes dans nginx.conf
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

### Certificat SSL invalide

```bash
# Renouveler le certificat
certbot renew

# Recopier les certificats
cp /etc/letsencrypt/live/votre-domaine.com/*.pem ssl/
```
