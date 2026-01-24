# 🔍 Vérifier la Connexion au VPS

Guide pour vérifier que l'extension se connecte bien au serveur VPS.

## Méthode 1 : Console Chrome (Recommandée)

### 1. Installer l'extension

1. Ouvrez `chrome://extensions/`
2. Rechargez l'extension Chessr (icône ↻)

### 2. Ouvrir chess.com

1. Allez sur https://chess.com
2. Ouvrez la console Chrome : **F12** ou **Cmd+Option+J** (Mac)

### 3. Vérifier les logs

Dans la console, cherchez :

```
[Chessr Config] {
  serverUrl: "ws://135.125.201.246:3000",
  environment: "production"
}
```

✅ Si vous voyez `ws://135.125.201.246:3000` → Connecté au VPS
❌ Si vous voyez `ws://localhost:3000` → Build dev chargé

### 4. Vérifier la connexion WebSocket

Dans l'onglet **Network** de la console :
1. Cliquez sur l'onglet **WS** (WebSocket)
2. Vous devriez voir une connexion à `135.125.201.246:3000`
3. Status: **101 Switching Protocols** = ✅ Connecté

## Méthode 2 : Vérifier manuellement les settings

Dans la console Chrome sur chess.com :

```javascript
// Vérifier la config injectée
console.log('Server URL:', process.env.STOCKFISH_SERVER_URL);
// Devrait afficher: ws://135.125.201.246:3000

// Vérifier les settings de l'extension
chrome.storage.local.get(['settings'], (result) => {
  console.log('Settings serverUrl:', result.settings?.serverUrl);
  // Peut afficher n'importe quoi, mais le code force l'URL du build
});
```

## Méthode 3 : Tester une analyse

### 1. Démarrer une partie sur chess.com

1. Allez sur chess.com
2. Cliquez sur "Jouer en ligne"
3. Démarrez une partie

### 2. Vérifier que l'extension fonctionne

Vous devriez voir :
- Une sidebar Chessr à droite
- Des flèches de suggestion sur l'échiquier
- Une évaluation en temps réel

### 3. Vérifier les logs

Dans la console (F12), vous devriez voir :

```
WebSocket connected to ws://135.125.201.246:3000
[Pool] Ready with X engines
Client connected
```

## Méthode 4 : Tester depuis le VPS

Sur votre Mac, vérifiez les logs du serveur :

```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs -f'
```

Quand vous connectez l'extension, vous devriez voir :

```
chess-stockfish-server  | Client connected
```

## Méthode 5 : Vérifier dans le code buildé

```bash
# Chercher l'URL dans le build
grep -o "ws://[^\"]*" /Users/timothe/dev/chess/extension/dist/content.js

# Devrait afficher:
# ws://135.125.201.246:3000
```

## 🐛 Dépannage

### Je vois "ws://localhost:3000" dans les logs

❌ Vous avez chargé un build dev au lieu du build prod

**Solution :**
```bash
cd /Users/timothe/dev/chess/extension
npm run build:prod
# Rechargez l'extension dans Chrome
```

### WebSocket connection failed

1. Vérifiez que le serveur VPS fonctionne :
   ```bash
   ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'
   ```

2. Testez la connexion manuellement :
   ```bash
   wscat -c ws://135.125.201.246:3000
   # Devrait afficher: {"type":"ready"}
   ```

### L'extension ne se charge pas

1. Rechargez l'extension : `chrome://extensions/` → icône ↻
2. Vérifiez les erreurs dans la console
3. Rebuild : `npm run clean && npm run build:prod`

## ✅ Checklist de Vérification

- [ ] Console Chrome affiche `ws://135.125.201.246:3000`
- [ ] Onglet Network/WS montre connexion au VPS
- [ ] Status 101 Switching Protocols
- [ ] Message `{"type":"ready"}` reçu
- [ ] Extension fonctionne sur une partie chess.com
- [ ] Logs VPS montrent "Client connected"

## 📸 Captures d'Écran des Logs

### Console Chrome (F12) :

```
[Chessr Config] {
  serverUrl: "ws://135.125.201.246:3000",
  environment: "production"
}
WebSocket connecting to ws://135.125.201.246:3000
WebSocket connected
< {"type":"ready"}
```

### Network Tab :

```
WS  135.125.201.246:3000  101 Switching Protocols
```

### Logs VPS :

```
chess-stockfish-server  | Client connected
chess-stockfish-server  | [Pool] Ready with 2 engines
```

---

**🎯 Si vous voyez ces 3 éléments, vous êtes connecté au VPS !**

1. URL = `ws://135.125.201.246:3000`
2. Status = `101 Switching Protocols`
3. Message = `{"type":"ready"}`
