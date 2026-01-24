# Guide d'Installation sur VPS

Ce guide vous accompagne pour installer le serveur Chess Stockfish sur un VPS Linux (Ubuntu/Debian).

## Prérequis

- Un VPS avec Ubuntu 20.04+ ou Debian 10+
- Accès root ou sudo
- Un nom de domaine (optionnel, recommandé pour la production)

## Étape 1 : Connexion au VPS

```bash
ssh root@votre-ip-vps
```

## Étape 2 : Mise à jour du système

```bash
apt update && apt upgrade -y
```

## Étape 3 : Installation de Node.js

```bash
# Installation de Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Vérification
node --version
npm --version
```

## Étape 4 : Installation de Stockfish

```bash
# Installation de Stockfish depuis les dépôts
apt install -y stockfish

# Vérification
stockfish --version
```

**Note :** Pour obtenir la dernière version de Stockfish (recommandé) :

```bash
cd /tmp
wget https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-ubuntu-x86-64-avx2.tar
tar -xvf stockfish-ubuntu-x86-64-avx2.tar
cp stockfish/stockfish-ubuntu-x86-64-avx2 /usr/local/bin/stockfish
chmod +x /usr/local/bin/stockfish
```

## Étape 5 : Installation de PM2 (gestionnaire de processus)

```bash
npm install -g pm2
```

## Étape 6 : Préparation du serveur

```bash
# Création d'un utilisateur dédié (recommandé pour la sécurité)
useradd -m -s /bin/bash chessserver
usermod -aG sudo chessserver

# Création du répertoire d'application
mkdir -p /opt/chess-server
chown chessserver:chessserver /opt/chess-server
```

## Étape 7 : Transfert des fichiers

Depuis votre machine locale :

```bash
# Compression du serveur
cd /Users/timothe/dev/chess
tar -czf chess-server.tar.gz server/

# Transfert via SCP
scp chess-server.tar.gz root@votre-ip-vps:/opt/chess-server/

# Ou via rsync (plus efficace)
rsync -avz --exclude 'node_modules' --exclude 'dist' server/ root@votre-ip-vps:/opt/chess-server/
```

Sur le VPS :

```bash
cd /opt/chess-server
tar -xzf chess-server.tar.gz --strip-components=1
rm chess-server.tar.gz
chown -R chessserver:chessserver /opt/chess-server
```

## Étape 8 : Installation des dépendances et build

```bash
su - chessserver
cd /opt/chess-server

# Installation des dépendances
npm install

# Build du projet TypeScript
npm run build
```

## Étape 9 : Configuration

Créez un fichier de configuration `.env` :

```bash
nano /opt/chess-server/.env
```

Ajoutez :

```env
PORT=3000
NODE_ENV=production
```

Modifiez `src/index.ts` si nécessaire pour utiliser les variables d'environnement :

```typescript
const PORT = process.env.PORT || 3000;
```

## Étape 10 : Lancement avec PM2

```bash
cd /opt/chess-server

# Démarrage du serveur
pm2 start dist/index.js --name chess-stockfish-server

# Configuration du démarrage automatique
pm2 startup systemd
# Exécutez la commande affichée par PM2

pm2 save

# Vérification du statut
pm2 status
pm2 logs chess-stockfish-server
```

## Étape 11 : Configuration du Firewall

```bash
# Installation de UFW (si pas déjà installé)
apt install -y ufw

# Configuration des règles
ufw allow ssh
ufw allow 3000/tcp
ufw enable

# Vérification
ufw status
```

## Étape 12 : Configuration Nginx (Optionnel - Recommandé)

Pour utiliser un reverse proxy et ajouter SSL :

```bash
# Installation de Nginx
apt install -y nginx

# Configuration
nano /etc/nginx/sites-available/chess-server
```

Ajoutez :

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name votre-domaine.com;  # Remplacez par votre domaine

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activation :

```bash
ln -s /etc/nginx/sites-available/chess-server /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Ouvrir le port 80
ufw allow 'Nginx Full'
```

## Étape 13 : Ajout SSL avec Let's Encrypt (Optionnel)

```bash
# Installation de Certbot
apt install -y certbot python3-certbot-nginx

# Obtention du certificat
certbot --nginx -d votre-domaine.com

# Le renouvellement automatique est configuré par défaut
```

## Commandes utiles

```bash
# Voir les logs
pm2 logs chess-stockfish-server

# Redémarrer le serveur
pm2 restart chess-stockfish-server

# Arrêter le serveur
pm2 stop chess-stockfish-server

# Recharger après modification du code
cd /opt/chess-server
npm run build
pm2 restart chess-stockfish-server

# Mise à jour du serveur
cd /opt/chess-server
git pull  # Si vous utilisez git
npm install
npm run build
pm2 restart chess-stockfish-server
```

## Test de connexion

Depuis votre machine locale :

```bash
# Sans Nginx
wscat -c ws://votre-ip-vps:3000

# Avec Nginx
wscat -c ws://votre-domaine.com

# Test avec curl (juste pour vérifier que le serveur répond)
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" http://votre-ip-vps:3000
```

## Sécurité supplémentaire

### 1. Désactiver l'accès root SSH

```bash
nano /etc/ssh/sshd_config
```

Modifier :

```
PermitRootLogin no
```

Redémarrer SSH :

```bash
systemctl restart sshd
```

### 2. Limiter les connexions (rate limiting)

Dans la config Nginx :

```nginx
limit_req_zone $binary_remote_addr zone=chessapi:10m rate=10r/s;

server {
    ...
    location / {
        limit_req zone=chessapi burst=20;
        ...
    }
}
```

### 3. Monitoring

```bash
# Installer htop pour monitoring
apt install -y htop

# Monitoring PM2
pm2 monit
```

## Dépannage

### Le serveur ne démarre pas

```bash
pm2 logs chess-stockfish-server --lines 100
```

### Stockfish n'est pas trouvé

Vérifier que Stockfish est dans le PATH :

```bash
which stockfish
```

Si non trouvé, créer un lien symbolique :

```bash
ln -s /chemin/vers/stockfish /usr/local/bin/stockfish
```

### WebSocket ne se connecte pas

Vérifier que le port est ouvert :

```bash
netstat -tulpn | grep 3000
```

Vérifier les logs Nginx :

```bash
tail -f /var/log/nginx/error.log
```

## Performances

Pour un VPS avec plusieurs CPU, vous pouvez augmenter les ressources dans `src/index.ts` :

```typescript
const POOL_CONFIG = {
  minEngines: 4,      // Augmenter pour plus de capacité
  maxEngines: 16,     // Selon les CPU disponibles
  threads: 4,         // Threads par moteur
  hash: 128,          // Mémoire hash en MB
};
```

Reconstruire et redémarrer après modification.
