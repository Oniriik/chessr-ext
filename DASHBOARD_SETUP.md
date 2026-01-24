# Guide de déploiement du Dashboard Admin

## Vue d'ensemble

Le dashboard admin permet de gérer le serveur Stockfish avec :
- Métriques en temps réel (utilisateurs connectés, instances Stockfish)
- Terminal SSH pour exécuter des commandes
- Visualisation des logs Docker
- Contrôles Docker (restart/stop/start)
- Test d'analyse

## Prérequis

1. Le serveur Stockfish doit être déployé et accessible
2. Un compte Supabase avec des utilisateurs admin
3. Node.js 18+ installé

## Étape 1: Configuration Supabase

### 1.1 Récupérer le JWT Secret

1. Aller dans Supabase Dashboard: https://supabase.com/dashboard
2. Sélectionner votre projet `ratngdlkcvyfdmidtenx`
3. Aller dans **Settings** → **API**
4. Copier le **JWT Secret** (sous "JWT Settings")

### 1.2 Configurer les variables d'environnement du serveur

Sur le VPS, ajouter la variable d'environnement `SUPABASE_JWT_SECRET`:

```bash
ssh ubuntu@135.125.201.246
cd ~/chess-server
nano .env
```

Ajouter :
```
SUPABASE_JWT_SECRET=<votre-jwt-secret>
```

Redémarrer le serveur:
```bash
docker compose down
docker compose up -d --build
```

### 1.3 Configurer le dashboard

Éditer `/Users/timothe/dev/chess/dashboard/.env.local`:

```env
# Supabase - Déjà configuré
NEXT_PUBLIC_SUPABASE_URL=https://ratngdlkcvyfdmidtenx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# À COMPLÉTER
SUPABASE_SERVICE_ROLE_KEY=<votre-service-role-key>  # Dans Supabase Dashboard → Settings → API

# Emails admin (séparés par virgule)
ADMIN_EMAILS=votre-email@example.com,autre-admin@example.com

# SSH - Déjà configuré
SSH_HOST=135.125.201.246
SSH_USER=ubuntu
SSH_PASSWORD=Chess2026SecurePass!

# Serveur - Déjà configuré
NEXT_PUBLIC_CHESS_SERVER_URL=wss://ws.chessr.io
CHESS_METRICS_URL=http://135.125.201.246:3001
```

## Étape 2: Tester localement

```bash
cd /Users/timothe/dev/chess/dashboard
npm run dev
```

Ouvrir http://localhost:3000

1. Se connecter avec un compte Supabase dont l'email est dans `ADMIN_EMAILS`
2. Vérifier que les métriques s'affichent
3. Tester le terminal SSH
4. Vérifier les logs Docker
5. Tester une analyse

## Étape 3: Vérifier que le serveur expose le port 3001

Le fichier `docker-compose.yml` a déjà été mis à jour pour exposer le port 3001.

Vérifier sur le VPS:
```bash
ssh ubuntu@135.125.201.246
docker ps  # Vérifier que 3001:3001 est mappé
curl localhost:3001/metrics  # Devrait retourner du JSON
```

Si le port n'est pas exposé, redéployer:
```bash
cd ~/chess-server
docker compose down
docker compose up -d
```

## Étape 4: Déployer le dashboard (optionnel)

### Option A: Déploiement sur Vercel (recommandé)

1. Installer Vercel CLI:
```bash
npm install -g vercel
```

2. Déployer:
```bash
cd /Users/timothe/dev/chess/dashboard
vercel
```

3. Configurer les variables d'environnement dans Vercel Dashboard

### Option B: Déploiement local avec PM2

```bash
cd /Users/timothe/dev/chess/dashboard
npm run build

# Installer PM2
npm install -g pm2

# Démarrer
pm2 start npm --name "chessr-dashboard" -- start
pm2 save
pm2 startup  # Pour démarrage automatique
```

### Option C: Sur le VPS avec Nginx

1. Builder le dashboard:
```bash
cd /Users/timothe/dev/chess/dashboard
npm run build
```

2. Copier sur le VPS:
```bash
scp -r .next package.json package-lock.json ubuntu@135.125.201.246:~/dashboard/
```

3. Sur le VPS:
```bash
ssh ubuntu@135.125.201.246
cd ~/dashboard
npm install --production
pm2 start npm --name "chessr-dashboard" -- start
```

4. Configurer Nginx pour proxy le dashboard

## Étape 5: Utilisation

### Se connecter

1. Aller sur le dashboard (local ou déployé)
2. Se connecter avec un compte Supabase admin
3. Le dashboard vérifie que l'email est dans `ADMIN_EMAILS`

### Fonctionnalités

**Overview:**
- Voir les métriques en temps réel (rafraîchissement auto 5s)
- Voir la liste des utilisateurs authentifiés avec leurs emails
- Utiliser les boutons restart/stop/start Docker

**Terminal SSH:**
- Taper des commandes (ex: `docker ps`, `ls -la`)
- Cliquer "Execute" ou appuyer sur Entrée
- Voir l'output dans le terminal

**Docker Logs:**
- Les logs se chargent automatiquement
- Auto-refresh optionnel toutes les 5 secondes
- Choisir le nombre de lignes à afficher

**Test Analysis:**
- Entrer une position FEN
- Cliquer "Run Analysis Test"
- Voir le résultat et le temps de réponse

## Troubleshooting

### Erreur "Metrics server returned 500"
- Vérifier que le port 3001 est exposé: `docker ps`
- Vérifier les logs: `docker logs chess-stockfish-server`
- Le serveur a besoin de `jsonwebtoken` installé

### Erreur "Access denied"
- Vérifier que l'email de connexion est dans `ADMIN_EMAILS`
- Vérifier que `.env.local` est bien configuré

### SSH commands not working
- Vérifier que `SSH_PASSWORD` est correct
- Tester la connexion SSH manuellement: `ssh ubuntu@135.125.201.246`

### Auth token not sent from extension
- Vérifier que l'extension est connectée
- Ouvrir la console du navigateur pour voir les logs
- Vérifier que `SUPABASE_JWT_SECRET` est configuré sur le serveur

## Sécurité

- ⚠️ Ne jamais commit `.env.local`
- ⚠️ Utiliser HTTPS en production
- ⚠️ Limiter les emails admin au strict nécessaire
- ⚠️ Changer le mot de passe SSH régulièrement
- ⚠️ Considérer l'utilisation de clés SSH au lieu de mot de passe

## Maintenance

### Mettre à jour le serveur
```bash
cd /Users/timothe/dev/chess/server
npm run build
./deploy-server.sh
```

### Mettre à jour le dashboard
```bash
cd /Users/timothe/dev/chess/dashboard
git pull
npm install
npm run build
# Redémarrer selon votre méthode de déploiement
```

### Vérifier les logs
```bash
# Dashboard (si PM2)
pm2 logs chessr-dashboard

# Serveur
docker logs -f chess-stockfish-server
```
