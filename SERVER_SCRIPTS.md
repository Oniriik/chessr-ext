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

### 3. `./setup-git-remote.sh`
Configure l'accès Git sur le serveur distant (à exécuter une seule fois)

```bash
./setup-git-remote.sh
```

**Étapes :**
1. Installation de Git sur le serveur
2. Génération d'une clé SSH pour GitHub
3. Affichage de la clé publique à ajouter sur GitHub
4. Test de la connexion GitHub
5. Clone ou configuration du dépôt

**Utilisation :**
- **À exécuter une seule fois** lors de la première configuration
- Nécessaire avant d'utiliser `update-remote-server.sh`
- Reconfigure l'accès Git si les clés ont changé

**Important :**
- Le script affichera une clé SSH publique
- Vous devez l'ajouter sur GitHub : https://github.com/settings/keys
- Appuyer sur ENTRÉE une fois la clé ajoutée

**Durée :** ~2-3 minutes

---

### 4. `./update-remote-server.sh`
Met à jour le serveur depuis le dépôt Git distant

```bash
./update-remote-server.sh
```

**Prérequis :**
- Avoir exécuté `./setup-git-remote.sh` au moins une fois

**Étapes :**
1. Vérification du statut Git sur le serveur
2. Pull des dernières modifications depuis `git@github.com:Oniriik/chessr-ext.git`
3. Rebuild et redémarrage des conteneurs Docker
4. Vérification du déploiement

**Utilisation :**
- Après avoir poussé des modifications sur GitHub
- Pour déployer depuis le dépôt Git directement
- Alternative à `deploy-server.sh` (pas de build local)

**Avantages :**
- Pas besoin de build local
- Garantit la synchronisation avec le dépôt Git
- Plus rapide si les modifications sont déjà sur GitHub

**Durée :** ~1-2 minutes

---

### 5. `./check-server-status.sh`
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

### 6. `./view-remote-logs.sh [lignes]`
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

### 7. `./follow-remote-logs.sh`
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

### Configuration initiale (première fois) :
```bash
# 1. Configurer l'accès Git sur le serveur
./setup-git-remote.sh

# Note: Le script vous demandera d'ajouter une clé SSH sur GitHub
# Suivez les instructions affichées dans le terminal
```

### Après modification du code :

**Option A - Déploiement depuis local :**
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

**Option B - Déploiement depuis Git (recommandé) :**
```bash
# 1. Tester localement
cd server
npm run dev

# 2. Commit et push sur GitHub
git add .
git commit -m "Update server"
git push origin master

# 3. Mettre à jour le serveur depuis Git
cd ..
./update-remote-server.sh

# 4. Tester le serveur distant
node test-remote-debug.js

# 5. Rebuild l'extension en production
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
