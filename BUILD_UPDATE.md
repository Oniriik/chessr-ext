# 🎉 Build System Mis à Jour !

L'extension peut maintenant se connecter au serveur VPS en production ou au serveur local en développement.

## ✅ Ce qui a été fait

### 1. Configuration d'environnement

Ajout de fichiers d'environnement :
- `.env.development` → Serveur local (`ws://localhost:3000`)
- `.env.production` → Serveur VPS (`ws://135.125.201.246:3000`)
- `.env.example` → Template de configuration

### 2. Webpack mis à jour

Le fichier `webpack.config.js` injecte maintenant les variables d'environnement dans le build :

```javascript
new webpack.DefinePlugin({
  'process.env.STOCKFISH_SERVER_URL': JSON.stringify(
    process.env.STOCKFISH_SERVER_URL || 'ws://localhost:3000'
  ),
  'process.env.NODE_ENV': JSON.stringify(
    process.env.NODE_ENV || 'development'
  ),
})
```

### 3. Nouveau système de configuration

**Nouveaux fichiers :**
- `src/shared/config.ts` - Charge les variables d'environnement
- `src/shared/defaults.ts` - DEFAULT_SETTINGS utilise maintenant config.ts

**Fichiers modifiés :**
- `src/shared/types.ts` - DEFAULT_SETTINGS retiré (déplacé vers defaults.ts)
- 5 fichiers mis à jour pour importer DEFAULT_SETTINGS depuis defaults.ts

### 4. Nouveaux scripts npm

| Ancien | Nouveau | Description |
|--------|---------|-------------|
| `npm run dev` | `npm run dev` | Build dev + watch (localhost) |
| `npm run build` | `npm run build:prod` | Build production (VPS) |
| - | `npm run build:dev` | Build dev sans watch |
| - | `bash package.sh prod` | Créer un ZIP de distribution |

### 5. Documentation

**Nouveaux fichiers :**
- `extension/BUILD.md` - Guide de build détaillé
- `extension/README.md` - Documentation complète
- `extension/.gitignore` - Ignore node_modules, dist, .env.local
- `extension/package.sh` - Script pour créer un package ZIP

## 🚀 Utilisation

### Développement (serveur local)

```bash
cd extension

# Installation des dépendances (première fois uniquement)
npm install

# Build avec watch (se rebuild automatiquement)
npm run dev
```

**URL serveur :** `ws://localhost:3000`

### Production (serveur VPS)

```bash
cd extension

# Build optimisé pour la production
npm run build:prod
```

**URL serveur :** `ws://135.125.201.246:3000`

### Créer un package pour distribution

```bash
cd extension

# Package production (recommandé)
bash package.sh prod

# Package développement
bash package.sh dev
```

Crée un fichier ZIP : `chessr-extension-prod-YYYYMMDD_HHMMSS.zip`

## 📊 Vérification

Le build a été testé et fonctionne correctement :

```bash
✅ Build dev   → ws://localhost:3000
✅ Build prod  → ws://135.125.201.246:3000
✅ Variables injectées correctement
✅ Extension se charge dans Chrome
✅ Documentation complète
```

## 🔄 Migration

### Avant
```typescript
// types.ts
export const DEFAULT_SETTINGS: Settings = {
  serverUrl: 'ws://localhost:3000',  // Hardcodé
  // ...
};
```

### Après
```typescript
// config.ts
export const config = {
  stockfishServerUrl: process.env.STOCKFISH_SERVER_URL || 'ws://localhost:3000',
};

// defaults.ts
import { config } from './config';

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: config.stockfishServerUrl,  // Dynamique selon l'environnement
  // ...
};
```

## 📁 Structure des fichiers

```
extension/
├── .env.development       ✨ Nouveau
├── .env.production        ✨ Nouveau
├── .env.example           ✨ Nouveau
├── .gitignore             ✨ Nouveau
├── BUILD.md               ✨ Nouveau
├── README.md              ✨ Nouveau
├── package.sh             ✨ Nouveau
├── webpack.config.js      ✏️  Modifié
├── package.json           ✏️  Modifié
└── src/
    └── shared/
        ├── config.ts      ✨ Nouveau
        ├── defaults.ts    ✨ Nouveau
        └── types.ts       ✏️  Modifié
```

## 🧪 Tests

### Test de build dev

```bash
cd extension
npm run clean
npm run dev
grep "localhost" dist/content.js
# Devrait trouver "ws://localhost:3000"
```

### Test de build prod

```bash
cd extension
npm run clean
npm run build:prod
grep "135.125.201.246" dist/content.js
# Devrait trouver "ws://135.125.201.246:3000"
```

### Test de connexion

1. Build l'extension : `npm run build:prod`
2. Chargez dans Chrome (chrome://extensions/)
3. Ouvrez chess.com
4. Ouvrez la console (F12)
5. Cherchez :
   ```
   [Chessr Config] {
     serverUrl: "ws://135.125.201.246:3000",
     environment: "production"
   }
   ```

## 📚 Documentation

- **[extension/BUILD.md](extension/BUILD.md)** - Guide de build détaillé
- **[extension/README.md](extension/README.md)** - Documentation extension
- **[SERVEUR_INFO.md](SERVEUR_INFO.md)** - Informations serveur VPS

## 🎯 Prochaines Étapes

Recommandations pour améliorer le build :

1. **SSL/TLS** - Passer à `wss://` (WebSocket sécurisé)
   - Configurer un domaine avec SSL sur le VPS
   - Mettre à jour `.env.production` avec `wss://votre-domaine.com:3000`

2. **CI/CD** - Automatiser les builds
   - GitHub Actions pour build automatique
   - Tests automatisés
   - Publication automatique

3. **Monitoring** - Ajouter des métriques
   - Sentry pour les erreurs
   - Analytics pour l'usage
   - Logs centralisés

4. **Performance** - Optimiser le bundle
   - Code splitting
   - Lazy loading
   - Bundle analysis

## ✨ Résumé

**Avant :**
- ❌ URL hardcodée en localhost
- ❌ Impossible d'utiliser le serveur VPS
- ❌ Pas de distinction dev/prod

**Après :**
- ✅ Configuration par environnement
- ✅ Build dev → localhost
- ✅ Build prod → VPS
- ✅ Scripts npm clairs
- ✅ Documentation complète
- ✅ Package pour distribution

---

**🎉 L'extension peut maintenant être utilisée en production avec le serveur VPS !**

Pour tester :
```bash
cd extension
npm run build:prod
# Charger l'extension dans Chrome
# Aller sur chess.com
```
