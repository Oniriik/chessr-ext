# Build Instructions

Guide pour builder l'extension Chessr en mode développement ou production.

## Configuration

L'extension utilise des variables d'environnement pour configurer l'URL du serveur Stockfish.

### Fichiers d'environnement

- `.env.development` - Configuration pour le développement (serveur local)
- `.env.production` - Configuration pour la production (serveur VPS)
- `.env.example` - Template de configuration

**Ne modifiez pas ces fichiers directement**. Si vous avez besoin d'une configuration personnalisée, créez un fichier `.env.local` (il sera ignoré par git).

### Variables disponibles

- `STOCKFISH_SERVER_URL` - URL du serveur WebSocket Stockfish

## Scripts de Build

### Développement (avec hot-reload)

Build automatique à chaque modification, utilise le serveur local :

```bash
npm run dev
```

- URL du serveur : `ws://localhost:3000`
- Source maps complètes
- Hot reload activé

### Build Production

Build optimisé pour la production, se connecte au serveur VPS :

```bash
npm run build:prod
```

ou simplement :

```bash
npm run build
```

- URL du serveur : `ws://135.125.201.246:3000`
- Code minifié
- Source maps optimisées

### Build Développement (sans watch)

Build de développement sans hot-reload (utile pour tester localement) :

```bash
npm run build:dev
```

- URL du serveur : `ws://localhost:3000`
- Code non minifié

## Installation de l'Extension

### En mode développement

1. Buildez l'extension :
   ```bash
   npm run dev
   ```

2. Ouvrez Chrome et allez sur `chrome://extensions/`

3. Activez le "Mode développeur" (en haut à droite)

4. Cliquez sur "Charger l'extension non empaquetée"

5. Sélectionnez le dossier `/extension/dist`

6. L'extension est maintenant installée et se recharge automatiquement

### En mode production

1. Buildez l'extension :
   ```bash
   npm run build:prod
   ```

2. Ouvrez Chrome et allez sur `chrome://extensions/`

3. Activez le "Mode développeur"

4. Cliquez sur "Charger l'extension non empaquetée"

5. Sélectionnez le dossier `/extension/dist`

## Configuration Personnalisée

Si vous avez besoin d'une URL de serveur personnalisée :

1. Créez un fichier `.env.local` :
   ```bash
   cp .env.example .env.local
   ```

2. Modifiez l'URL :
   ```env
   STOCKFISH_SERVER_URL=ws://votre-serveur.com:3000
   ```

3. Buildez avec votre configuration :
   ```bash
   NODE_ENV=local npm run build
   ```

## URLs Serveur

### Développement (local)
- `ws://localhost:3000`

### Production (VPS OVH)
- `ws://135.125.201.246:3000`
- `ws://vps-8058cb7f.vps.ovh.net:3000`

## Dépannage

### L'extension ne se connecte pas au serveur

Vérifiez dans la console Chrome (F12) :

```javascript
// Vous devriez voir au chargement :
[Chessr Config] {
  serverUrl: "ws://...",
  environment: "development" // ou "production"
}
```

### Rebuilder complètement

```bash
npm run clean
npm run build
```

### Vérifier la configuration injectée

Le fichier `dist/content.js` contient les variables injectées. Cherchez :

```javascript
process.env.STOCKFISH_SERVER_URL
```

## Structure

```
extension/
├── .env.development      # Config dev (localhost)
├── .env.production       # Config prod (VPS)
├── .env.example          # Template
├── src/
│   ├── shared/
│   │   ├── config.ts     # Charge les variables d'environnement
│   │   ├── defaults.ts   # DEFAULT_SETTINGS avec config
│   │   └── types.ts      # Types TypeScript
│   └── ...
├── dist/                 # Build output (ignoré par git)
└── webpack.config.js     # Injecte les variables avec DefinePlugin
```

## Workflow Recommandé

### Pour développer localement

1. Démarrez le serveur local :
   ```bash
   cd ../server
   npm run dev
   ```

2. Démarrez le build en watch :
   ```bash
   cd ../extension
   npm run dev
   ```

3. Chargez l'extension dans Chrome

4. Codez ! L'extension se rebuild automatiquement

### Pour déployer en production

1. Assurez-vous que le serveur VPS fonctionne

2. Buildez l'extension :
   ```bash
   npm run build:prod
   ```

3. Testez localement avec le serveur de production

4. Distribuez le dossier `dist/` ou créez un package ZIP

## Prochaines Étapes

- [ ] Créer un script `package.sh` pour créer un ZIP de distribution
- [ ] Ajouter des tests automatisés
- [ ] Créer un workflow CI/CD pour les builds
- [ ] Ajouter des certificats SSL (wss://)
