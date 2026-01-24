# 🔒 URL du Serveur Forcée par le Build

## ✅ Modification Appliquée

L'extension utilise maintenant **TOUJOURS** l'URL du serveur définie lors du build, indépendamment de ce qui est sauvegardé dans le chrome.storage.

## 🔧 Ce qui a été modifié

### 1. `settings.repository.ts`

```typescript
async get(): Promise<Settings> {
  const result = await chrome.storage.sync.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...result.settings };

  // ALWAYS use the server URL from build config
  settings.serverUrl = config.stockfishServerUrl;

  return settings;
}

async save(partial: Partial<Settings>): Promise<void> {
  // Remove serverUrl from partial to prevent it from being saved
  const { serverUrl, ...settingsToSave } = partial;
  // ...
}
```

### 2. `cloud-settings.repository.ts`

Même logique appliquée pour Supabase :
- `get()` force l'URL du build
- `save()` ignore les changements de serverUrl
- `sync()` force l'URL du build

## 🎯 Comportement

### Build Dev (`npm run dev`)
- ✅ Se connecte **TOUJOURS** à `ws://localhost:3000`
- ❌ L'utilisateur ne peut **PAS** changer l'URL du serveur
- ✅ Même si l'ancien storage dit "135.125.201.246", il utilisera "localhost"

### Build Prod (`npm run build:prod`)
- ✅ Se connecte **TOUJOURS** à `ws://135.125.201.246:3000`
- ❌ L'utilisateur ne peut **PAS** changer l'URL du serveur
- ✅ Même si l'ancien storage dit "localhost", il utilisera le VPS

## 📊 Avantages

1. **Migration facile** : Pas besoin de réinitialiser le chrome.storage
2. **Sécurité** : L'utilisateur ne peut pas changer le serveur
3. **Cohérence** : Dev = localhost, Prod = VPS, toujours
4. **Débogage simple** : Un build = un serveur, pas d'ambiguïté

## 🧪 Test

### 1. Sans réinitialiser le storage

Même avec les anciens settings, l'extension utilisera l'URL du build :

```javascript
// Dans la console Chrome (F12)
chrome.storage.local.get(['settings'], (result) => {
  console.log('Storage:', result.settings?.serverUrl);  // Peut être localhost
});

// Mais l'extension utilisera quand même :
// Build prod → ws://135.125.201.246:3000
// Build dev  → ws://localhost:3000
```

### 2. Vérifier l'URL utilisée

Dans la console sur chess.com :

```
[Chessr Config] {
  serverUrl: "ws://135.125.201.246:3000",  ← URL du build (forcée)
  environment: "production"
}
```

## 🔄 Migration depuis l'ancienne version

### Pas besoin de rien faire !

1. L'ancienne extension peut rester installée
2. Rechargez simplement l'extension depuis `dist/`
3. L'URL sera automatiquement celle du build

### Si vous voulez quand même nettoyer (optionnel)

```javascript
// Console Chrome
chrome.storage.local.clear();
chrome.storage.sync.clear();
```

## ⚠️ Note Importante

L'URL du serveur n'est **plus modifiable** par l'utilisateur. Si vous voulez permettre à l'utilisateur de changer le serveur, il faudra :

1. Créer un setting "customServerUrl" séparé
2. Ajouter une option "Utiliser un serveur personnalisé"
3. Modifier le code pour utiliser customServerUrl si activé

Pour l'instant, l'URL est **totalement contrôlée par le build**.

## 📝 Résumé

| Aspect | Avant | Après |
|--------|-------|-------|
| URL source | chrome.storage | Build config (forcé) |
| Build dev | localStorage(?) | **ws://localhost:3000** |
| Build prod | localStorage(?) | **ws://135.125.201.246:3000** |
| Modifiable | Oui (problématique) | Non (sécurisé) |
| Migration | Manuelle | **Automatique** |

---

**🎉 Plus de problème de settings obsolètes !**

L'extension utilise maintenant **toujours** l'URL correcte selon le type de build.
