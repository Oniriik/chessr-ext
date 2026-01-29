# Configuration Nginx - Chessr

## Vue d'ensemble

Nginx est configuré comme reverse proxy pour les trois domaines de Chessr, avec SSL/TLS automatique via Let's Encrypt.

## Domaines Configurés

### dashboard.chessr.io
- **Port backend**: 3000
- **Type**: Application web (dashboard admin)
- **SSL**: Actif (Let's Encrypt)
- **Redirection HTTP → HTTPS**: Automatique

### engine.chessr.io
- **Port backend**: 8080
- **Type**: WebSocket server (Komodo chess engine)
- **SSL**: Actif (Let's Encrypt)
- **Redirection HTTP → HTTPS**: Automatique
- **Timeouts WebSocket**: 7 jours

### download.chessr.io
- **Type**: Serveur de fichiers statiques (extension navigateur)
- **Root directory**: `/opt/chessr/extension`
- **SSL**: Actif (Let's Encrypt)
- **Redirection HTTP → HTTPS**: Automatique
- **Compression gzip**: Activée
- **Cache**: 1h pour fichiers statiques (.zip, .html, .json, images)

## Fichiers de Configuration

### Emplacements
```
/opt/chessr/nginx/
├── dashboard.chessr.io.conf    # Config dashboard
├── engine.chessr.io.conf       # Config engine (WebSocket)
└── download.chessr.io.conf     # Config distribution extension

Liens symboliques:
/etc/nginx/sites-available/     → Sources
/etc/nginx/sites-enabled/       → Configs actives
```

### Dashboard (dashboard.chessr.io)

Fichier: `/opt/chessr/nginx/dashboard.chessr.io.conf`

```nginx
server {
    listen 80;
    server_name dashboard.chessr.io;

    # Logs
    access_log /opt/chessr/logs/dashboard-access.log;
    error_log /opt/chessr/logs/dashboard-error.log;

    # Proxy vers le container dashboard
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Note**: Certbot ajoute automatiquement la configuration HTTPS et la redirection.

### Engine WebSocket (engine.chessr.io)

Fichier: `/opt/chessr/nginx/engine.chessr.io.conf`

```nginx
server {
    listen 80;
    server_name engine.chessr.io;

    # Logs
    access_log /opt/chessr/logs/engine-access.log;
    error_log /opt/chessr/logs/engine-error.log;

    # WebSocket proxy vers le container engine
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts pour WebSocket
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

### Download - Distribution Extension (download.chessr.io)

Fichier: `/opt/chessr/nginx/download.chessr.io.conf`

```nginx
server {
    listen 80;
    server_name download.chessr.io;

    # Logs
    access_log /opt/chessr/logs/download-access.log;
    error_log /opt/chessr/logs/download-error.log;

    # Root directory for extension files
    root /opt/chessr/extension;

    # Default file
    index index.html;

    # Serve static files
    location / {
        try_files $uri $uri/ =404;
    }

    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Cache static files
    location ~* \.(zip|html|json|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1h;
        add_header Cache-Control "public, immutable";
    }
}
```

**Note**: Cette configuration sert des fichiers statiques (extension .zip) directement depuis `/opt/chessr/extension`. Pas de proxy, juste du serving de fichiers.

## Certificats SSL

### Informations
- **Provider**: Let's Encrypt
- **Type**: ECDSA
- **Domaines couverts**: dashboard.chessr.io, engine.chessr.io, download.chessr.io
- **Expiration**: 2026-04-28 (renouvellement automatique)
- **Certificats**: Un certificat séparé par domaine
  - `/etc/letsencrypt/live/dashboard.chessr.io/`
  - `/etc/letsencrypt/live/engine.chessr.io/`
  - `/etc/letsencrypt/live/download.chessr.io/`

### Renouvellement Automatique
Certbot a configuré un timer systemd pour le renouvellement automatique :
```bash
systemctl status certbot.timer
```

Le renouvellement s'effectue automatiquement ~30 jours avant expiration.

## Commandes Utiles

### Tester la configuration
```bash
nginx -t
```

### Recharger Nginx
```bash
systemctl reload nginx
```

### Redémarrer Nginx
```bash
systemctl restart nginx
```

### Voir les logs en temps réel
```bash
# Dashboard
tail -f /opt/chessr/logs/dashboard-access.log
tail -f /opt/chessr/logs/dashboard-error.log

# Engine
tail -f /opt/chessr/logs/engine-access.log
tail -f /opt/chessr/logs/engine-error.log

# Download
tail -f /opt/chessr/logs/download-access.log
tail -f /opt/chessr/logs/download-error.log
```

### Gérer les certificats SSL
```bash
# Voir tous les certificats
certbot certificates

# Renouveler manuellement (normalement automatique)
certbot renew

# Tester le renouvellement
certbot renew --dry-run
```

## Backends

### Ports Docker (Proxy)
Les containers Docker doivent exposer ces ports **localement** :
- **Dashboard**: `localhost:3000` (reverse proxy)
- **Engine**: `localhost:8080` (reverse proxy WebSocket)

### Fichiers Statiques
- **Download**: `/opt/chessr/extension` (serving direct de fichiers)

Nginx s'occupe de la terminaison SSL et du routage.

## Sécurité

- ✅ HTTPS forcé sur tous les domaines
- ✅ Certificats SSL valides
- ✅ Headers de sécurité configurés
- ✅ Logs séparés par domaine
- ✅ Renouvellement SSL automatique

## Troubleshooting

### 502 Bad Gateway
Signifie que Nginx ne peut pas se connecter au backend (port 3000 ou 8080).
- Vérifier que les containers Docker sont en cours d'exécution
- Vérifier les ports avec `netstat -tlnp | grep -E '3000|8080'`

### Erreur SSL
```bash
# Vérifier les certificats
certbot certificates

# Forcer le renouvellement
certbot renew --force-renewal
```

### Logs
```bash
# Nginx global
journalctl -u nginx -f

# Logs applicatifs
ls -lh /opt/chessr/logs/
```
