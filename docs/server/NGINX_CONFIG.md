# Configuration Nginx - Chessr

## Vue d'ensemble

Nginx est configuré comme reverse proxy pour les deux domaines de Chessr, avec SSL/TLS automatique via Let's Encrypt.

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

## Fichiers de Configuration

### Emplacements
```
/opt/chessr/nginx/
├── dashboard.chessr.io.conf    # Config dashboard
└── engine.chessr.io.conf       # Config engine (WebSocket)

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

## Certificats SSL

### Informations
- **Provider**: Let's Encrypt
- **Type**: ECDSA
- **Domaines couverts**: dashboard.chessr.io, engine.chessr.io
- **Expiration**: 2026-04-28 (renouvellement automatique)
- **Chemin certificat**: `/etc/letsencrypt/live/dashboard.chessr.io/fullchain.pem`
- **Chemin clé privée**: `/etc/letsencrypt/live/dashboard.chessr.io/privkey.pem`

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

## Ports Backend Attendus

Les containers Docker doivent exposer ces ports **localement** :
- **Dashboard**: `localhost:3000`
- **Engine**: `localhost:8080`

Nginx s'occupe de la terminaison SSL et du routage vers ces ports.

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
