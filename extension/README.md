# Chessr Extension

Extension Chrome d'assistance échecs avec analyse Stockfish en temps réel sur chess.com.

## 🚀 Quick Start

### Build pour le développement (serveur local)

```bash
npm install
npm run dev
```

L'extension se rebuild automatiquement à chaque modification et se connecte à `ws://localhost:3000`.

### Build pour la production (serveur VPS)

```bash
npm install
npm run build:prod
```

L'extension se connecte au serveur VPS sur `ws://135.125.201.246:3000`.

### Installation dans Chrome

1. Ouvrez `chrome://extensions/`
2. Activez le "Mode développeur"
3. Cliquez sur "Charger l'extension non empaquetée"
4. Sélectionnez le dossier `extension/dist`

## 📦 Scripts Disponibles

| Script | Description | Serveur |
|--------|-------------|---------|
| `npm run dev` | Build dev + watch | localhost:3000 |
| `npm run build` | Build production | VPS (135.125.201.246:3000) |
| `npm run build:prod` | Build production | VPS (135.125.201.246:3000) |
| `npm run build:dev` | Build dev (sans watch) | localhost:3000 |
| `npm run clean` | Nettoyer dist/ | - |

### Package pour distribution

```bash
# Package en mode production
bash package.sh prod

# Package en mode développement
bash package.sh dev
```

Crée un fichier ZIP prêt à être distribué.

## 🔧 Configuration

### Variables d'environnement

L'extension utilise des fichiers d'environnement :

- `.env.development` → `ws://localhost:3000` (défaut pour dev)
- `.env.production` → `ws://135.125.201.246:3000` (défaut pour prod)
- `.env.example` → Template

### Configuration personnalisée

Pour utiliser une URL personnalisée, créez `.env.local` :

```bash
cp .env.example .env.local
# Éditez .env.local avec votre URL
```

Puis buildez avec :

```bash
NODE_ENV=local npm run build
```

## 📚 Documentation

- **[BUILD.md](BUILD.md)** - Guide de build détaillé
- **[../SERVEUR_INFO.md](../SERVEUR_INFO.md)** - Informations sur le serveur VPS

## 🏗️ Architecture

```
extension/
├── src/
│   ├── content/           # Content script (interface sur chess.com)
│   ├── presentation/      # Components React & UI
│   ├── domain/            # Logique métier
│   ├── infrastructure/    # Services & repositories
│   ├── application/       # Use cases
│   └── shared/
│       ├── config.ts      # Configuration (charge les env vars)
│       ├── defaults.ts    # DEFAULT_SETTINGS (utilise config)
│       └── types.ts       # Types TypeScript
├── public/
│   ├── manifest.json      # Manifest Chrome Extension
│   └── icons/             # Icônes
├── dist/                  # Build output (généré)
│   ├── content.js
│   ├── content.css
│   └── manifest.json
├── .env.development       # Config dev
├── .env.production        # Config prod
├── webpack.config.js      # Configuration Webpack
└── package.json
```

## 🔌 Connexion au Serveur

### Développement
- **URL:** `ws://localhost:3000`
- **Utilisation:** Tests locaux, développement

### Production
- **URL:** `ws://135.125.201.246:3000`
- **Alternative:** `ws://vps-8058cb7f.vps.ovh.net:3000`
- **Utilisation:** Distribution, utilisateurs finaux

## 🧪 Test

### Vérifier la configuration injectée

Après le build, cherchez dans la console Chrome (F12) :

```
[Chessr Config] {
  serverUrl: "ws://135.125.201.246:3000",
  environment: "production"
}
```

### Tester la connexion

1. Ouvrez chess.com
2. Démarrez une partie
3. L'extension doit se connecter automatiquement
4. Vérifiez les logs dans la console

## 🐛 Dépannage

### L'extension ne se charge pas

```bash
npm run clean
npm install
npm run build
```

### L'extension ne se connecte pas au serveur

1. Vérifiez que le serveur fonctionne :
   ```bash
   # Local
   wscat -c ws://localhost:3000

   # Production
   wscat -c ws://135.125.201.246:3000
   ```

2. Vérifiez la configuration dans la console Chrome

3. Rechargez l'extension dans `chrome://extensions/`

### Erreurs de build

```bash
# Supprimer node_modules et réinstaller
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 🔐 Sécurité

⚠️ **Important** :
- Ne commitez jamais les fichiers `.env.local`
- Les fichiers `.env.development` et `.env.production` sont dans le repo car ils contiennent des URLs publiques
- Pour des secrets (clés API, tokens), utilisez `.env.local` qui est ignoré par git

## 📝 Workflow de Développement

### Setup initial

```bash
cd extension
npm install
```

### Développer localement

Terminal 1 - Serveur :
```bash
cd ../server
npm run dev
```

Terminal 2 - Extension :
```bash
cd extension
npm run dev
```

Terminal 3 - Tests :
```bash
# Tester la connexion au serveur
wscat -c ws://localhost:3000
```

### Déployer en production

```bash
# 1. Build de l'extension
npm run build:prod

# 2. Tester avec le serveur de production
# Charger l'extension dans Chrome
# Aller sur chess.com et tester

# 3. Créer un package pour distribution
bash package.sh prod

# 4. Le fichier ZIP est prêt à être distribué
```

## 📈 Performances

Le build production optimise :
- ✅ Minification du code
- ✅ Tree shaking
- ✅ Source maps optimisées
- ✅ Compression des assets

Taille du bundle final : ~466 KB (normal pour une extension React)

## 🛠️ Technologies

- **React 19** - UI
- **TypeScript** - Typage
- **Webpack 5** - Bundler
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **WebSocket** - Communication serveur

## 📄 Licence

MIT

---

**Développé avec ❤️ pour les joueurs d'échecs**

Pour plus d'informations sur le serveur, voir [SERVEUR_INFO.md](../SERVEUR_INFO.md)
