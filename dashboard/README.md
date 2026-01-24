# Chessr Admin Dashboard

Admin dashboard pour gérer le serveur Stockfish de Chessr.

## Fonctionnalités

- **Overview**: Métriques du serveur en temps réel
  - Nombre de clients connectés
  - Nombre d'utilisateurs authentifiés
  - Instances Stockfish (total/disponibles/en file d'attente)
  - Liste des emails des utilisateurs connectés
  - Contrôles Docker (restart/stop/start)

- **SSH Terminal**: Terminal SSH pour exécuter des commandes sur le VPS

- **Docker Logs**: Visualisation des logs Docker en temps réel avec auto-refresh

- **Test Analysis**: Tester une analyse avec le serveur Stockfish

## Installation

1. Installer les dépendances:
```bash
cd dashboard
npm install
```

2. Configurer les variables d'environnement:
   - Copier `.env.local.example` vers `.env.local`
   - Compléter les valeurs manquantes:
     - `SUPABASE_SERVICE_ROLE_KEY`: Récupérer dans Supabase Dashboard -> Settings -> API
     - `ADMIN_EMAILS`: Ajouter votre email admin

3. Lancer en développement:
```bash
npm run dev
```

4. Ouvrir http://localhost:3000

## Configuration

### Variables d'environnement requises

- `NEXT_PUBLIC_SUPABASE_URL`: URL Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Clé publique Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Clé service role (admin)
- `ADMIN_EMAILS`: Liste d'emails admin (séparés par virgule)
- `SSH_HOST`: IP du VPS
- `SSH_USER`: Utilisateur SSH
- `SSH_PASSWORD`: Mot de passe SSH
- `NEXT_PUBLIC_CHESS_SERVER_URL`: URL WebSocket du serveur chess
- `CHESS_METRICS_URL`: URL HTTP de l'endpoint metrics

### Authentification

Le dashboard utilise Supabase Auth. Seuls les utilisateurs dont l'email est dans `ADMIN_EMAILS` peuvent accéder au dashboard.

## Utilisation

1. Se connecter avec un compte Supabase dont l'email est dans la liste des admins
2. Naviguer entre les onglets pour accéder aux différentes fonctionnalités
3. Les métriques se rafraîchissent automatiquement toutes les 5 secondes

## Déploiement

```bash
npm run build
npm start
```

## Sécurité

- Toutes les API routes vérifient l'authentification admin
- Les commandes SSH sont whitelistées (pas d'exécution arbitraire)
- Les credentials SSH sont stockés côté serveur uniquement
- Les tokens Supabase sont validés à chaque requête
