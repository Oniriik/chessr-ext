# Scripts de Déploiement VPS

Scripts automatisés pour installer et déployer le serveur Chess Stockfish sur un VPS.

## Scripts Disponibles

### 1. `install-vps.sh`
Installation initiale du VPS (Node.js, Stockfish, PM2, firewall).

**Usage:**
```bash
# Sur le VPS, en tant que root
curl -fsSL https://raw.githubusercontent.com/votre-repo/scripts/install-vps.sh | bash
# ou
wget -O - https://raw.githubusercontent.com/votre-repo/scripts/install-vps.sh | bash
```

### 2. `deploy.sh`
Déploie l'application (install npm, build, démarre avec PM2).

**Usage:**
```bash
# Sur le VPS, dans /opt/chess-server
bash scripts/deploy.sh
```

### 3. `setup-nginx.sh`
Configure Nginx comme reverse proxy.

**Usage:**
```bash
# Sur le VPS, en tant que root
bash scripts/setup-nginx.sh votre-domaine.com
```

## Installation Rapide

### Méthode 1 : Installation Complète en Une Fois

Sur le VPS:

```bash
# 1. Installation de base
curl -fsSL https://votre-url/install-vps.sh | bash

# 2. Transfert des fichiers depuis votre machine locale
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  /Users/timothe/dev/chess/server/ \
  root@votre-ip:/opt/chess-server/

# 3. Déploiement
cd /opt/chess-server
bash scripts/deploy.sh

# 4. (Optionnel) Configuration Nginx
bash scripts/setup-nginx.sh votre-domaine.com
certbot --nginx -d votre-domaine.com
```

### Méthode 2 : Installation Manuelle Pas à Pas

Suivez le guide détaillé dans [DEPLOYMENT.md](../DEPLOYMENT.md).

## Commandes de Gestion

Après l'installation, utilisez ces commandes:

```bash
# Voir les logs en temps réel
pm2 logs chess-stockfish-server

# Redémarrer l'application
pm2 restart chess-stockfish-server

# Arrêter l'application
pm2 stop chess-stockfish-server

# Monitoring
pm2 monit

# Statut
pm2 status
```

## Mise à Jour de l'Application

```bash
# Sur votre machine locale, transférez les nouveaux fichiers
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  server/ root@votre-ip:/opt/chess-server/

# Sur le VPS
cd /opt/chess-server
bash scripts/deploy.sh
```

## Structure Recommandée

```
/opt/chess-server/
├── dist/              # Code compilé
├── src/               # Code source
├── scripts/           # Scripts de déploiement
├── node_modules/      # Dépendances
├── package.json
└── tsconfig.json
```

## Dépannage

### Script échoue avec "permission denied"

```bash
chmod +x scripts/*.sh
```

### Node.js non trouvé après installation

```bash
source ~/.bashrc
# ou
export PATH=$PATH:/usr/bin
```

### PM2 n'est pas dans le PATH

```bash
npm install -g pm2
source ~/.bashrc
```

## Sécurité

Ces scripts incluent:
- ✅ Création d'un utilisateur dédié
- ✅ Configuration du firewall (UFW)
- ✅ Rate limiting Nginx
- ✅ Isolation des processus avec PM2

Recommandations supplémentaires:
- Utilisez des clés SSH au lieu de mots de passe
- Désactivez l'accès root SSH
- Configurez fail2ban
- Mettez en place une surveillance (monitoring)
