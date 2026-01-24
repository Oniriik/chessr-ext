# Configuration du domaine ws.chessr.io

## 🎯 Vue d'ensemble

Ce guide explique comment configurer le domaine `ws.chessr.io` pour exposer le serveur WebSocket Chess Stockfish avec SSL/TLS.

## 📋 Prérequis

- Domaine: `chessr.io` acheté et accessible
- Serveur: `135.125.201.246` (Ubuntu)
- Accès SSH configuré

## 🚀 Configuration en 3 étapes

### Étape 1: Configuration DNS

Chez ton registrar (où tu as acheté `chessr.io`), ajoute cet enregistrement DNS :

```
Type: A
Nom: ws
Valeur: 135.125.201.246
TTL: 300 (ou Auto)
```

**Résultat:** `ws.chessr.io` → `135.125.201.246`

**Vérification:**
```bash
# Attends 2-5 minutes puis vérifie
dig +short ws.chessr.io
# Doit retourner: 135.125.201.246
```

### Étape 2: Déploiement automatique

Une fois le DNS configuré, lance le script :

```bash
cd /Users/timothe/dev/chess
bash scripts/setup-domain.sh
```

**Le script va :**
1. ✅ Copier la configuration NGINX sur le serveur
2. ✅ Installer certbot (si nécessaire)
3. ✅ Te demander de confirmer que le DNS est configuré
4. ✅ Obtenir le certificat SSL Let's Encrypt
5. ✅ Activer la configuration
6. ✅ Tester la connexion

### Étape 3: Mettre à jour l'extension

Le serveur sera accessible sur: **`wss://ws.chessr.io`**

Il faudra mettre à jour l'URL dans l'extension Chrome.

## 📁 Fichiers créés

- `nginx/ws.chessr.io.conf` - Configuration NGINX
- `scripts/setup-domain.sh` - Script de déploiement automatique

## 🔧 Configuration NGINX

La configuration NGINX inclut :
- ✅ Redirection HTTP → HTTPS
- ✅ Certificat SSL Let's Encrypt
- ✅ Proxy WebSocket vers port 3000
- ✅ Headers de sécurité (HSTS, X-Frame-Options, etc.)
- ✅ Rate limiting (20 req/s par IP)
- ✅ Timeouts optimisés pour WebSocket
- ✅ Logs dédiés

## 🧪 Tests

### Test DNS
```bash
dig +short ws.chessr.io
# Attendu: 135.125.201.246
```

### Test HTTP (avant SSL)
```bash
curl -I http://ws.chessr.io
# Attendu: 301 Redirect vers HTTPS
```

### Test HTTPS
```bash
curl -I https://ws.chessr.io
# Attendu: 200 OK ou 101 Switching Protocols
```

### Test WebSocket
```bash
wscat -c wss://ws.chessr.io
# Attendu: {"type":"ready"}
```

### Test complet avec analyse
```bash
echo '{"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":10,"multiPV":1}' | \
  wscat -c wss://ws.chessr.io -w 5
```

## 🔒 Sécurité

### Certificat SSL
- **Provider:** Let's Encrypt
- **Renouvellement:** Automatique (certbot)
- **Validité:** 90 jours (renouvelé tous les 60 jours)

### Headers de sécurité
- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection`

### Rate limiting
- 20 requêtes/seconde par IP
- Burst: 50 requêtes
- Protection contre les abus

## 📊 Monitoring

### Logs NGINX
```bash
# Logs d'accès
ssh ubuntu@135.125.201.246 'sudo tail -f /var/log/nginx/ws.chessr.io-access.log'

# Logs d'erreur
ssh ubuntu@135.125.201.246 'sudo tail -f /var/log/nginx/ws.chessr.io-error.log'
```

### Statut du serveur
```bash
# Vérifier NGINX
ssh ubuntu@135.125.201.246 'sudo systemctl status nginx'

# Vérifier le serveur WebSocket
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'
```

### Renouvellement SSL
```bash
# Vérifier l'expiration du certificat
ssh ubuntu@135.125.201.246 'sudo certbot certificates'

# Forcer le renouvellement (si besoin)
ssh ubuntu@135.125.201.246 'sudo certbot renew --force-renewal'
```

## 🔄 Mise à jour

### Modifier la configuration NGINX
```bash
# 1. Éditer le fichier local
vim nginx/ws.chessr.io.conf

# 2. Copier sur le serveur
scp nginx/ws.chessr.io.conf ubuntu@135.125.201.246:/tmp/

# 3. Appliquer sur le serveur
ssh ubuntu@135.125.201.246 'sudo mv /tmp/ws.chessr.io.conf /etc/nginx/sites-available/ws.chessr.io && sudo nginx -t && sudo systemctl reload nginx'
```

## 🆘 Troubleshooting

### Le DNS ne se propage pas
```bash
# Vérifier depuis plusieurs serveurs DNS
dig @8.8.8.8 ws.chessr.io
dig @1.1.1.1 ws.chessr.io
```
**Solution:** Attendre 5-15 minutes (propagation DNS)

### Erreur SSL
```bash
# Vérifier le certificat
ssh ubuntu@135.125.201.246 'sudo certbot certificates'

# Logs certbot
ssh ubuntu@135.125.201.246 'sudo tail -f /var/log/letsencrypt/letsencrypt.log'
```

### NGINX ne démarre pas
```bash
# Tester la config
ssh ubuntu@135.125.201.246 'sudo nginx -t'

# Voir les logs
ssh ubuntu@135.125.201.246 'sudo journalctl -u nginx -n 50'
```

### WebSocket ne connecte pas
```bash
# Vérifier que le serveur tourne
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'

# Tester en local sur le serveur
ssh ubuntu@135.125.201.246 'curl -i localhost:3000'
```

## 🎉 URLs finales

- **Production:** `wss://ws.chessr.io`
- **Health check:** `https://ws.chessr.io/health`
- **Serveur IP:** `ws://135.125.201.246:3000` (fallback, non sécurisé)

## 📝 Prochaines étapes

Après avoir configuré le domaine :

1. ✅ Vérifier que `wss://ws.chessr.io` fonctionne
2. 🔄 Mettre à jour l'extension avec la nouvelle URL
3. 🏗️ Rebuild l'extension
4. 🔄 Recharger l'extension dans Chrome
5. 🧪 Tester sur chess.com

## 💡 Notes

- Le certificat SSL est gratuit (Let's Encrypt)
- Renouvellement automatique via cron
- WebSocket supporte les connexions longues (7 jours max)
- Rate limiting pour éviter les abus
- Logs conservés dans `/var/log/nginx/`
