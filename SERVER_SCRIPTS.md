# 🛠️ Scripts de gestion du serveur distant

Scripts pour gérer le serveur Chess Stockfish hébergé sur `wss://ws.chessr.io` (135.125.201.246)

## 📋 Scripts disponibles

### 1. `./restart-remote-server.sh`
Redémarre le serveur Docker sans rebuild

```bash
./restart-remote-server.sh
```

**Utilisation :**
- Le serveur ne répond plus
- Besoin d'un redémarrage rapide
- Après un changement de configuration NGINX

**Durée :** ~10 secondes

---

### 2. `./deploy-server.sh`
Déploie une nouvelle version du serveur (build + upload + rebuild)

```bash
./deploy-server.sh
```

**Étapes :**
1. Build local du serveur
2. Création d'une archive
3. Upload sur le serveur
4. Extraction et rebuild Docker
5. Vérification du déploiement

**Utilisation :**
- Après avoir modifié le code du serveur
- Pour déployer de nouvelles fonctionnalités
- Pour corriger des bugs

**Durée :** ~2-3 minutes

---

### 3. `./check-server-status.sh`
Vérifie l'état du serveur et teste la connexion

```bash
./check-server-status.sh
```

**Affiche :**
- État du conteneur Docker
- Santé du serveur (health check)
- Logs récents
- Test de connexion WebSocket

**Utilisation :**
- Vérifier si le serveur fonctionne
- Diagnostiquer un problème
- Après un déploiement

**Durée :** ~15 secondes

---

### 4. `./view-remote-logs.sh [lignes]`
Affiche les derniers logs du serveur

```bash
./view-remote-logs.sh        # 30 dernières lignes (défaut)
./view-remote-logs.sh 100    # 100 dernières lignes
```

**Utilisation :**
- Voir les erreurs récentes
- Vérifier l'activité du serveur
- Diagnostiquer un problème

---

### 5. `./follow-remote-logs.sh`
Suit les logs du serveur en temps réel

```bash
./follow-remote-logs.sh
# Appuyer sur Ctrl+C pour arrêter
```

**Utilisation :**
- Déboguer en temps réel
- Voir les requêtes entrantes
- Surveiller les performances

---

## 🧪 Scripts de test

### `./test-remote-server.js`
Test simple de connexion au serveur

```bash
node test-remote-server.js
```

### `./test-remote-debug.js`
Test détaillé avec tous les messages

```bash
node test-remote-debug.js
```

---

## 🚨 Résolution de problèmes

### Le serveur ne répond pas
```bash
# 1. Vérifier le statut
./check-server-status.sh

# 2. Voir les logs
./view-remote-logs.sh 50

# 3. Redémarrer si nécessaire
./restart-remote-server.sh
```

### Erreur "EPIPE" ou "Engine crashed"
```bash
# Le serveur a besoin d'être redéployé avec les dernières corrections
./deploy-server.sh
```

### Le serveur est "unhealthy"
```bash
# 1. Voir les logs pour comprendre
./follow-remote-logs.sh

# 2. Redémarrer
./restart-remote-server.sh

# 3. Si ça persiste, redéployer
./deploy-server.sh
```

---

## 📝 Commandes SSH utiles

Pour se connecter manuellement au serveur :

```bash
./ssh-connect.sh "commande"
```

Exemples :
```bash
# Voir tous les conteneurs
./ssh-connect.sh "sudo docker ps -a"

# Entrer dans le conteneur
./ssh-connect.sh "sudo docker exec -it chess-stockfish-server sh"

# Voir l'utilisation CPU/RAM
./ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"
```

---

## 🔧 Configuration serveur

**Serveur :** 135.125.201.246
**Utilisateur :** ubuntu
**Port WebSocket :** 3000
**URL publique :** wss://ws.chessr.io
**Container :** chess-stockfish-server

**Fichiers sur le serveur :**
- `/home/ubuntu/chess-server/` - Code source
- `/home/ubuntu/chess-server/docker-compose.yml` - Config Docker
- `/home/ubuntu/chess-server/Dockerfile` - Image Docker

---

## 🎯 Workflow typique

### Après modification du code :
```bash
# 1. Tester localement
cd server
npm run dev

# 2. Déployer sur le serveur distant
cd ..
./deploy-server.sh

# 3. Tester le serveur distant
node test-remote-debug.js

# 4. Rebuild l'extension en production
cd extension
npm run build:prod
```

### En cas de problème en production :
```bash
# 1. Vérifier le statut
./check-server-status.sh

# 2. Voir les logs
./follow-remote-logs.sh

# 3. Redémarrer si besoin
./restart-remote-server.sh
```

---

## ⚠️ Notes importantes

- Les scripts utilisent `expect` pour gérer l'authentification SSH automatiquement
- Le mot de passe est intégré dans les scripts (à sécuriser en production)
- Le serveur redémarre automatiquement en cas de crash (restart: unless-stopped)
- Les logs sont limités à 10MB par 3 fichiers max
- Le health check vérifie toutes les 30 secondes

---

## 📊 Monitoring

Pour surveiller le serveur en continu, vous pouvez utiliser :

```bash
# Terminal 1 : Logs en temps réel
./follow-remote-logs.sh

# Terminal 2 : Stats CPU/RAM toutes les 5 secondes
watch -n 5 './ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"'
```
