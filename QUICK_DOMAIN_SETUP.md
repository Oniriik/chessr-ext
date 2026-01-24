# 🚀 Configuration rapide de ws.chessr.io

## Étape 1: Configuration DNS ⚙️

Chez ton registrar (où tu as acheté `chessr.io`), ajoute cet enregistrement :

```
Type: A
Nom: ws
Valeur: 135.125.201.246
TTL: 300
```

**Attends 2-5 minutes pour la propagation DNS**

Vérifie que c'est actif :
```bash
dig +short ws.chessr.io
# Doit retourner: 135.125.201.246
```

## Étape 2: Déploiement sur le serveur 🔧

Lance le script de configuration :

```bash
cd /Users/timothe/dev/chess
bash scripts/setup-domain.sh
```

Le script va :
- ✅ Copier la config NGINX
- ✅ Installer certbot
- ✅ Obtenir le certificat SSL
- ✅ Activer wss://ws.chessr.io

## Étape 3: Rebuild l'extension 🏗️

L'extension est **déjà configurée** pour utiliser `wss://ws.chessr.io`.

Rebuild la version production :

```bash
cd /Users/timothe/dev/chess/extension
npm run build:prod
```

## Étape 4: Recharger l'extension Chrome 🔄

1. Ouvre Chrome → `chrome://extensions/`
2. Clique sur le bouton de rechargement ↻ de l'extension Chessr
3. Va sur chess.com et teste

## Test rapide 🧪

Une fois tout déployé, teste la connexion :

```bash
# Test WebSocket
wscat -c wss://ws.chessr.io

# Tu devrais recevoir
# > {"type":"ready"}
```

## Fichiers modifiés ✅

- ✅ `nginx/ws.chessr.io.conf` - Config NGINX (créé)
- ✅ `scripts/setup-domain.sh` - Script de déploiement (créé)
- ✅ `.env.production` - URL mise à jour vers `wss://ws.chessr.io`

## URLs 🌐

- **Dev:** `ws://localhost:3000`
- **Prod:** `wss://ws.chessr.io` ⬅️ **NOUVEAU**
- **Ancien:** `wss://135.125.201.246` (toujours actif en fallback)

## En cas de problème 🆘

Si le WebSocket ne connecte pas après avoir rechargé l'extension :

1. Ouvre la console Chrome (F12) sur chess.com
2. Regarde les erreurs de connexion
3. Vérifie que le DNS pointe bien : `dig +short ws.chessr.io`
4. Teste manuellement : `wscat -c wss://ws.chessr.io`

## Prochaines fois 🔄

Pour rebuild après modifications :

```bash
# Dev (localhost)
npm run build:dev

# Production (wss://ws.chessr.io)
npm run build:prod
```

---

**C'est prêt !** 🎉

Le serveur sera accessible sur **wss://ws.chessr.io** une fois le DNS propagé et le script lancé.
