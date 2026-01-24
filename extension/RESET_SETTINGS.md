# Réinitialiser les Settings de l'Extension

Si l'extension se connecte toujours à localhost malgré un nouveau build, c'est parce que les anciens settings sont sauvegardés dans le chrome.storage.

## Solution 1 : Via la Console Chrome

1. Ouvrez Chrome sur chess.com
2. Ouvrez la console (F12)
3. Collez ce code :

```javascript
chrome.storage.local.clear(() => {
  console.log('✅ Settings réinitialisés !');
  location.reload();
});
```

4. Rechargez la page

## Solution 2 : Désinstaller/Réinstaller

1. Allez sur `chrome://extensions/`
2. Supprimez l'extension Chessr
3. Rechargez l'extension depuis le dossier `dist`

## Solution 3 : Script de Debug

1. Ouvrez la console sur chess.com
2. Vérifiez les settings actuels :

```javascript
chrome.storage.local.get(['settings'], (result) => {
  console.log('Settings actuels:', result.settings);
});
```

3. Si serverUrl = localhost, réinitialisez :

```javascript
chrome.storage.local.set({
  settings: {
    serverUrl: 'ws://135.125.201.246:3000',
    enabled: true,
    targetElo: 1500,
    mode: 'balanced'
  }
}, () => {
  console.log('✅ Settings mis à jour vers VPS !');
  location.reload();
});
```

## Vérification

Après réinitialisation, vous devriez voir dans la console :

```
[Chessr Config] {
  serverUrl: "ws://135.125.201.246:3000",
  environment: "production"
}
```
