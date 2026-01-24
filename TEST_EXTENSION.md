# 🧪 Test de l'Extension - Connexion au VPS

Guide complet pour tester que votre extension se connecte bien au serveur VPS.

## 📋 Checklist Rapide

- [ ] Extension installée/rechargée
- [ ] Console ouverte (F12)
- [ ] Sur chess.com
- [ ] Message de config visible
- [ ] WebSocket connecté au VPS

---

## 🔧 ÉTAPE 1 : Installer/Recharger l'Extension

### Si l'extension existe déjà :
1. Allez sur `chrome://extensions/`
2. Trouvez "Chessr" dans la liste
3. Cliquez sur l'icône **↻ Recharger**
4. Passez à l'étape 2

### Si l'extension n'existe pas :
1. Allez sur `chrome://extensions/`
2. Activez **"Mode développeur"** (coin supérieur droit)
3. Cliquez sur **"Charger l'extension non empaquetée"**
4. Naviguez vers : `/Users/timothe/dev/chess/extension/dist`
5. Cliquez sur **"Sélectionner"**

✅ **Vérification :** L'extension "Chessr" apparaît dans la liste

---

## 🌐 ÉTAPE 2 : Ouvrir chess.com avec la Console

1. **Ouvrez un nouvel onglet**

2. **Ouvrez la console AVANT d'aller sur le site :**
   - Appuyez sur **F12** (Windows/Linux)
   - Ou **Cmd+Option+J** (Mac)
   - Ou Clic droit → Inspecter → Console

3. **Allez sur** : https://chess.com

4. **Attendez le chargement complet**

---

## 🔍 ÉTAPE 3 : Vérifier les Logs

Dans la console, cherchez ces messages :

### ✅ Message 1 : Configuration
```
[Chessr Config] {
  serverUrl: "ws://135.125.201.246:3000",
  environment: "production",
  isDevelopment: false,
  isProduction: true
}
```

**✅ BON SIGNE :** Vous voyez `ws://135.125.201.246:3000`
**❌ PROBLÈME :** Vous voyez `ws://localhost:3000` → Mauvais build

### ✅ Message 2 : Connexion WebSocket
```
WebSocket connecting to ws://135.125.201.246:3000
WebSocket connected
```

### ✅ Message 3 : Message du serveur
```
< {"type":"ready"}
```

**🎉 Si vous voyez ces 3 messages, l'extension est connectée au VPS !**

---

## 🌐 ÉTAPE 4 : Vérifier dans l'Onglet Network

1. Dans la console (F12), cliquez sur l'onglet **"Network"**
2. Cliquez sur le sous-onglet **"WS"** (pour WebSocket)
3. Si rien ne s'affiche, **rafraîchissez la page** (Cmd+R ou F5)

### Vous devriez voir :

```
Name: 135.125.201.246:3000
Status: 101 Switching Protocols
Type: websocket
```

4. **Cliquez sur cette ligne** pour voir les détails
5. Dans l'onglet **"Messages"**, vous devriez voir :
   ```
   ↓ {"type":"ready"}
   ```

**✅ Status 101 = Connexion WebSocket établie !**

---

## 🎮 ÉTAPE 5 : Tester en Jeu

1. Sur chess.com, cliquez sur **"Jouer en ligne"**
2. Démarrez une partie (peu importe le mode)
3. L'extension devrait :
   - Afficher une sidebar à droite
   - Montrer des flèches de suggestions
   - Afficher une évaluation

### Vérifier dans la console pendant le jeu :

Vous devriez voir des messages d'analyse :

```
> {"type":"analyze","fen":"...","depth":15,...}
< {"type":"info","depth":10,"score":{"type":"cp","value":25},...}
< {"type":"bestmove","bestMove":"e2e4",...}
```

**🎉 Si vous voyez ces messages, tout fonctionne !**

---

## 🐛 DÉPANNAGE

### ❌ Je vois "ws://localhost:3000" dans les logs

**Problème :** Mauvais build chargé

**Solution :**
```bash
cd /Users/timothe/dev/chess/extension
npm run clean
npm run build:prod
```

Puis rechargez l'extension dans Chrome.

### ❌ WebSocket connection failed

**Problème :** Le serveur VPS ne répond pas

**Solution :** Vérifier que le serveur fonctionne
```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'
```

Si le serveur est arrêté :
```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml up -d'
```

### ❌ Aucun message dans la console

**Problème :** L'extension ne s'est pas chargée

**Solution :**
1. Allez sur `chrome://extensions/`
2. Vérifiez qu'il n'y a pas d'erreur en rouge
3. Rechargez l'extension (icône ↻)
4. Rechargez la page chess.com

### ❌ L'extension ne s'affiche pas en jeu

**Problème :** Content script non injecté

**Solution :**
1. Vérifiez que vous êtes bien en **partie en cours** (pas sur la page d'accueil)
2. Ouvrez `chrome://extensions/`
3. Cliquez sur "Détails" de l'extension Chessr
4. Vérifiez que "Autoriser en navigation privée" est activé si vous testez en privé

---

## ✅ CHECKLIST FINALE

- [ ] Message config avec `ws://135.125.201.246:3000`
- [ ] Message "WebSocket connected"
- [ ] Message `{"type":"ready"}` reçu
- [ ] Network tab montre connexion WS au VPS
- [ ] Status 101 Switching Protocols
- [ ] Extension visible en jeu
- [ ] Messages d'analyse dans la console

**🎉 Si tous les points sont cochés, votre extension est connectée au VPS !**

---

## 📸 Captures d'Écran Attendues

### Console Tab
```
[Chessr Config] { serverUrl: "ws://135.125.201.246:3000", ... }
WebSocket connecting to ws://135.125.201.246:3000
WebSocket connected
< {"type":"ready"}
```

### Network → WS Tab
```
135.125.201.246:3000    websocket    101    ...
```

### Network → WS → Messages
```
↓ {"type":"ready"}
↑ {"type":"analyze",...}
↓ {"type":"info",...}
↓ {"type":"bestmove",...}
```

---

## 🔗 Liens Utiles

- **Extension:** `/Users/timothe/dev/chess/extension/dist`
- **Logs serveur:** `ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs -f'`
- **Test VPS:** `wscat -c ws://135.125.201.246:3000`

---

## 📞 Commandes Rapides

```bash
# Rebuild l'extension
cd /Users/timothe/dev/chess/extension && npm run build:prod

# Vérifier le serveur VPS
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'

# Voir les logs VPS
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs --tail=50'

# Tester la connexion VPS
wscat -c ws://135.125.201.246:3000
```
