# 🔧 Configuration du déploiement Git

Guide pour configurer le déploiement automatique depuis GitHub vers le serveur distant.

## 📋 Vue d'ensemble

Au lieu de builder localement et d'uploader les fichiers, vous pouvez configurer le serveur pour qu'il récupère directement les mises à jour depuis GitHub.

**Avantages :**
- ✅ Déploiement plus rapide
- ✅ Pas de build local nécessaire
- ✅ Garantit la synchronisation avec le dépôt Git
- ✅ Workflow Git standard (commit → push → deploy)

---

## 🚀 Configuration initiale (à faire une seule fois)

### Étape 1 : Exécuter le script de configuration

```bash
./setup-git-remote.sh
```

Ce script va :
1. Installer Git sur le serveur distant
2. Générer une clé SSH pour GitHub
3. Afficher la clé publique à copier

### Étape 2 : Ajouter la clé SSH sur GitHub

Le script affichera une clé SSH publique comme celle-ci :
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJvZ... ubuntu@chess-server
```

**Ajoutez-la sur GitHub :**
1. Allez sur https://github.com/settings/keys
2. Cliquez sur **"New SSH key"**
3. Titre : `Chess Server (135.125.201.246)`
4. Collez la clé SSH
5. Cliquez sur **"Add SSH key"**

### Étape 3 : Continuer le script

Appuyez sur **ENTRÉE** dans le terminal pour continuer.

Le script va :
- Tester la connexion GitHub
- Cloner ou configurer le dépôt
- Vérifier que tout fonctionne

---

## 🔄 Utilisation quotidienne

Une fois la configuration initiale terminée, voici le workflow pour déployer :

### 1. Développement local
```bash
cd /Users/timothe/dev/chess/server
npm run dev
# Testez vos modifications...
```

### 2. Commit et push
```bash
git add .
git commit -m "Description de vos modifications"
git push origin master
```

### 3. Déploiement sur le serveur
```bash
./update-remote-server.sh
```

### 4. Test
```bash
node test-remote-debug.js
```

---

## 🔍 Vérification de la configuration

Pour vérifier si Git est bien configuré sur le serveur :

```bash
./ssh-connect.sh "cd /home/ubuntu/chess-server && git remote -v && git status"
```

Vous devriez voir :
```
origin  git@github.com:Oniriik/chessr-ext.git (fetch)
origin  git@github.com:Oniriik/chessr-ext.git (push)
```

---

## 🛠️ Résolution de problèmes

### Erreur "Permission denied (publickey)"

La clé SSH n'est pas configurée correctement.

**Solution :**
```bash
# 1. Récupérer la clé publique
./ssh-connect.sh "cat ~/.ssh/id_ed25519.pub"

# 2. Vérifier qu'elle est bien ajoutée sur GitHub
# https://github.com/settings/keys

# 3. Tester la connexion
./ssh-connect.sh "ssh -T git@github.com"
```

### Erreur "GIT_NOT_CONFIGURED"

Le dépôt Git n'est pas initialisé.

**Solution :**
```bash
./setup-git-remote.sh
```

### Erreur "fatal: not a git repository"

Le répertoire existe mais n'est pas un dépôt Git.

**Solution :**
```bash
# Option 1: Reconfigurer
./setup-git-remote.sh

# Option 2: Nettoyer et recloner
./ssh-connect.sh "rm -rf /home/ubuntu/chess-server"
./setup-git-remote.sh
```

### Le serveur ne pull pas les dernières modifications

**Solution :**
```bash
# Vérifier la branche
./ssh-connect.sh "cd /home/ubuntu/chess-server && git branch -a"

# Forcer le pull
./ssh-connect.sh "cd /home/ubuntu/chess-server && git reset --hard origin/master && git pull origin master"
```

---

## 📝 Comparaison des méthodes de déploiement

| Critère | `deploy-server.sh` | `update-remote-server.sh` |
|---------|-------------------|--------------------------|
| **Build local** | ✅ Oui | ❌ Non |
| **Upload fichiers** | ✅ Via SCP | ❌ Git pull |
| **Configuration** | ❌ Aucune | ✅ Une fois |
| **Vitesse** | 🐢 2-3 min | ⚡ 1-2 min |
| **Sync Git** | ⚠️ Pas garanti | ✅ Garanti |
| **Usage** | Dev rapide | Production |

---

## 🎯 Recommandation

**Pour le développement rapide :**
- Utilisez `./deploy-server.sh` si vous testez des modifications fréquentes

**Pour la production :**
1. Configurez Git avec `./setup-git-remote.sh` (une seule fois)
2. Utilisez `./update-remote-server.sh` pour les déploiements

---

## 📚 Scripts disponibles

| Script | Description |
|--------|-------------|
| `./setup-git-remote.sh` | Configuration initiale (une fois) |
| `./update-remote-server.sh` | Déploiement depuis Git |
| `./deploy-server.sh` | Déploiement build local |
| `./check-server-status.sh` | Vérifier le statut |
| `./view-remote-logs.sh` | Voir les logs |

---

## ✅ Checklist de configuration

- [ ] Exécuter `./setup-git-remote.sh`
- [ ] Ajouter la clé SSH sur https://github.com/settings/keys
- [ ] Vérifier la connexion GitHub
- [ ] Tester `./update-remote-server.sh`
- [ ] Vérifier que le serveur fonctionne

---

**🎉 Une fois configuré, vous pouvez déployer en 1 minute !**
