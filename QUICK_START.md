# 🚀 Guide de Démarrage Rapide

Installation du serveur Chess Stockfish sur un VPS en quelques minutes.

## Quelle méthode choisir ?

### 🐳 Docker (Recommandé pour la plupart)

**Choisir si :**
- Vous voulez une installation rapide (< 5 minutes)
- Vous préférez l'isolation et la sécurité
- Vous voulez des mises à jour faciles
- Vous débutez avec les VPS

📖 **Guide:** [DEPLOYMENT_DOCKER.md](DEPLOYMENT_DOCKER.md)

### ⚙️ Installation Classique

**Choisir si :**
- Vous voulez les meilleures performances
- Vous avez besoin de contrôle total
- Vous êtes à l'aise avec Linux
- Vous voulez un debugging plus simple

📖 **Guide:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Installation Express avec Docker

### 1️⃣ Préparation du VPS (une seule fois)

```bash
# Se connecter au VPS
ssh root@votre-ip-vps

# Installer Docker
curl -fsSL https://get.docker.com | sh

# Installer Docker Compose
apt install -y docker-compose-plugin
```

### 2️⃣ Transfert des fichiers

Depuis votre machine locale :

```bash
cd /Users/timothe/dev/chess

# Créer une archive
tar -czf chess-server.tar.gz server/ docker-compose.yml

# Transférer
scp chess-server.tar.gz root@votre-ip-vps:/opt/

# Ou utiliser rsync (plus rapide pour les mises à jour)
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  server/ docker-compose.yml root@votre-ip-vps:/opt/chess-server/
```

### 3️⃣ Démarrage

Sur le VPS :

```bash
cd /opt/chess-server

# Build et démarrage
docker compose up -d

# Vérifier les logs
docker compose logs -f
```

### 4️⃣ Test

```bash
# Sur le VPS
curl -i http://localhost:3000

# Depuis votre machine
wscat -c ws://votre-ip-vps:3000
```

**✅ C'est terminé !** Votre serveur est en ligne sur `ws://votre-ip-vps:3000`

---

## Installation Express Classique

### 1️⃣ Installation automatique

```bash
# Se connecter au VPS
ssh root@votre-ip-vps

# Télécharger et exécuter le script
curl -fsSL https://raw.githubusercontent.com/votre-repo/scripts/install-vps.sh | bash

# Ou si vous avez les fichiers localement
cd /Users/timothe/dev/chess
scp scripts/install-vps.sh root@votre-ip-vps:/tmp/
ssh root@votre-ip-vps "bash /tmp/install-vps.sh"
```

### 2️⃣ Transfert des fichiers

```bash
# Depuis votre machine locale
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  server/ root@votre-ip-vps:/opt/chess-server/
```

### 3️⃣ Déploiement

```bash
# Sur le VPS
cd /opt/chess-server
bash scripts/deploy.sh
```

### 4️⃣ Test

```bash
pm2 logs chess-stockfish-server
bash scripts/test-server.sh
```

**✅ C'est terminé !** Votre serveur tourne avec PM2.

---

## Ajouter un Nom de Domaine (Optionnel)

### Avec Docker + Nginx

```bash
# Sur le VPS
cd /opt/chess-server

# Créer la config Nginx
mkdir -p nginx
nano nginx/nginx.conf
# (Copier la config depuis DEPLOYMENT_DOCKER.md)

# Démarrer avec Nginx
docker compose --profile with-nginx up -d

# Ajouter SSL
certbot certonly --standalone -d votre-domaine.com
mkdir -p nginx/ssl
cp /etc/letsencrypt/live/votre-domaine.com/*.pem nginx/ssl/
docker compose --profile with-nginx restart
```

### Avec Installation Classique

```bash
# Sur le VPS
bash scripts/setup-nginx.sh votre-domaine.com

# Ajouter SSL
apt install -y certbot python3-certbot-nginx
certbot --nginx -d votre-domaine.com
```

**✅ Votre serveur est maintenant accessible sur `wss://votre-domaine.com`**

---

## Commandes Essentielles

### Avec Docker

```bash
# Voir les logs
docker compose logs -f

# Redémarrer
docker compose restart

# Arrêter
docker compose down

# Mise à jour
docker compose build && docker compose up -d
```

### Avec PM2

```bash
# Voir les logs
pm2 logs chess-stockfish-server

# Redémarrer
pm2 restart chess-stockfish-server

# Statut
pm2 status

# Monitoring
pm2 monit
```

---

## Test de Connexion

### Installation de wscat

```bash
npm install -g wscat
```

### Test basique

```bash
wscat -c ws://votre-ip-vps:3000

# Après connexion, envoyer :
> {"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":15}
```

### Script de test automatique

```bash
# Depuis votre machine locale
cd /Users/timothe/dev/chess
bash scripts/test-server.sh votre-ip-vps 3000
```

---

## Mise à Jour du Serveur

### Méthode Rapide (Docker)

```bash
# Sur votre machine locale
rsync -avz --exclude 'node_modules' server/ root@votre-ip-vps:/opt/chess-server/server/

# Sur le VPS
cd /opt/chess-server
docker compose build
docker compose up -d
```

### Méthode Rapide (Classique)

```bash
# Sur votre machine locale
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  server/ root@votre-ip-vps:/opt/chess-server/

# Sur le VPS
cd /opt/chess-server
bash scripts/deploy.sh
```

---

## Dépannage Express

### Le serveur ne démarre pas

```bash
# Docker
docker compose logs chess-server

# PM2
pm2 logs chess-stockfish-server
```

### Impossible de se connecter

```bash
# Vérifier que le serveur écoute
netstat -tulpn | grep 3000

# Vérifier le firewall
ufw status

# Ouvrir le port si nécessaire
ufw allow 3000/tcp
```

### Stockfish non trouvé

```bash
# Vérifier l'installation
which stockfish
stockfish --version

# Réinstaller si nécessaire
apt install -y stockfish
```

---

## Ressources

- 📖 [Guide Docker Complet](DEPLOYMENT_DOCKER.md)
- 📖 [Guide Installation Classique](DEPLOYMENT.md)
- 📖 [Documentation API](server/README.md)
- 🛠️ [Scripts d'installation](scripts/)

---

## Besoin d'Aide ?

1. ✅ Consultez les guides détaillés
2. ✅ Vérifiez les logs
3. ✅ Utilisez le script de test
4. ✅ Vérifiez la configuration du firewall

---

## Checklist de Production

- [ ] Serveur installé et fonctionnel
- [ ] Firewall configuré (UFW)
- [ ] Nom de domaine configuré (optionnel)
- [ ] SSL/TLS activé (recommandé)
- [ ] Monitoring en place (PM2/Docker)
- [ ] Sauvegardes configurées
- [ ] Rate limiting activé (Nginx)
- [ ] Tests de connexion validés

**🎉 Félicitations ! Votre serveur Stockfish est prêt !**
