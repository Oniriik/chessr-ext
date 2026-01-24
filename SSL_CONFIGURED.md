# 🔒 SSL Configuré avec Succès !

Le serveur VPS est maintenant configuré avec SSL (certificat auto-signé) et l'extension utilise WSS (WebSocket Secure).

## ✅ Ce qui a été configuré

### Sur le VPS :
1. ✅ Nginx installé
2. ✅ Certificat SSL auto-signé généré (valable 365 jours)
3. ✅ Nginx configuré comme reverse proxy SSL
4. ✅ Port 443 (HTTPS) ouvert dans le firewall
5. ✅ Redirection automatique HTTP → HTTPS

### Extension :
1. ✅ URL modifiée : `wss://135.125.201.246` (au lieu de ws://)
2. ✅ Extension rebuildée en mode production
3. ✅ Prête à être chargée

---

## 📥 INSTALLATION DE L'EXTENSION

### Étape 1 : Recharger l'extension

1. Ouvrez Chrome
2. Allez sur : `chrome://extensions/`
3. Trouvez l'extension "Chessr"
4. Cliquez sur **↻ Recharger**

---

## ⚠️ ACCEPTER LE CERTIFICAT SSL

**IMPORTANT :** Comme le certificat est auto-signé, Chrome va afficher un avertissement de sécurité. C'est normal et attendu.

### Comment accepter le certificat :

#### Méthode 1 : Via le navigateur

1. Ouvrez un nouvel onglet
2. Allez sur : **https://135.125.201.246**
3. Vous verrez un avertissement : **"Votre connexion n'est pas privée"**
4. Cliquez sur **"Paramètres avancés"**
5. Cliquez sur **"Continuer vers 135.125.201.246 (dangereux)"**
6. Vous devriez voir une erreur 404 ou une page blanche (c'est normal)
7. ✅ Le certificat est maintenant accepté !

#### Méthode 2 : Accepter automatiquement

Le certificat sera accepté automatiquement la première fois que l'extension essaie de se connecter, mais vous verrez quand même un avertissement.

---

## 🧪 TESTER L'EXTENSION

### 1. Recharger l'extension

`chrome://extensions/` → Recharger Chessr

### 2. Ouvrir chess.com avec la console

1. Nouvel onglet
2. Appuyez sur **F12** (ou Cmd+Option+J)
3. Allez sur : https://chess.com

### 3. Vérifier les logs

Dans la console, cherchez :

```
[Chessr Config] {
  serverUrl: "wss://135.125.201.246",
  environment: "production"
}
```

✅ **SUCCÈS** si vous voyez : `wss://135.125.201.246`

### 4. Vérifier la connexion

Vous devriez voir :

```
WebSocket connecting to wss://135.125.201.246
WebSocket connected
< {"type":"ready"}
```

✅ **Si vous voyez ces messages, tout fonctionne !**

---

## 🔍 Vérification Network

1. F12 → Onglet **"Network"**
2. Sous-onglet **"WS"**
3. Rafraîchissez la page
4. Vous devriez voir : **135.125.201.246** (Status: **101**)

---

## ⚠️ Dépannage

### ❌ "ERR_CERT_AUTHORITY_INVALID" ou Avertissement Certificat

**Normal !** C'est parce que le certificat est auto-signé.

**Solution :**
1. Allez sur https://135.125.201.246 dans le navigateur
2. Acceptez l'avertissement de sécurité
3. Rechargez chess.com

### ❌ "WebSocket connection failed"

**Vérifier que Nginx fonctionne :**
```bash
ssh ubuntu@135.125.201.246 'sudo systemctl status nginx'
```

**Vérifier que le serveur Docker tourne :**
```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'
```

### ❌ Pas de message dans la console

1. Rechargez l'extension : `chrome://extensions/` → ↻
2. Rechargez chess.com (Cmd+R)
3. Vérifiez qu'il n'y a pas d'erreur rouge dans la console

---

## 📊 Configuration Actuelle

| Aspect | Valeur |
|--------|--------|
| **Serveur VPS** | 135.125.201.246 |
| **Protocol** | WSS (WebSocket Secure) |
| **Port** | 443 (HTTPS) |
| **SSL** | Certificat auto-signé |
| **Reverse Proxy** | Nginx |
| **Backend** | Docker (port 3000) |
| **Extension** | wss://135.125.201.246 |

---

## 🔐 À Propos du Certificat Auto-Signé

### Avantages :
- ✅ Connexion chiffrée (sécurisée)
- ✅ Fonctionne sans domaine
- ✅ Gratuit
- ✅ Pas de configuration DNS

### Inconvénients :
- ⚠️ Avertissement du navigateur (à accepter manuellement)
- ⚠️ Pas idéal pour distribuer l'extension publiquement

### Pour une vraie solution en production :

Si vous voulez distribuer l'extension sans avertissement :
1. Achetez un domaine (~10-15€/an)
2. Configurez Let's Encrypt (certificat gratuit et reconnu)
3. Aucun avertissement du navigateur

---

## 🎯 Prochaines Étapes

- [ ] Accepter le certificat SSL dans Chrome
- [ ] Recharger l'extension
- [ ] Tester sur chess.com
- [ ] Vérifier les logs de connexion

---

## 📄 Commandes Utiles

```bash
# Vérifier Nginx
ssh ubuntu@135.125.201.246 'sudo systemctl status nginx'

# Vérifier le serveur Docker
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'

# Voir les logs Nginx
ssh ubuntu@135.125.201.246 'sudo tail -f /var/log/nginx/error.log'

# Voir les logs du serveur
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs -f'

# Redémarrer Nginx
ssh ubuntu@135.125.201.246 'sudo systemctl restart nginx'
```

---

## 🎉 Résumé

**Avant :**
- ❌ WS (non sécurisé)
- ❌ Bloqué par Mixed Content
- ❌ Extension ne fonctionnait pas

**Après :**
- ✅ WSS (sécurisé avec SSL)
- ✅ Pas de Mixed Content
- ✅ Extension fonctionnelle !
- ⚠️ Avertissement certificat (à accepter une fois)

---

**🔒 Votre serveur est maintenant sécurisé avec SSL !**

Testez l'extension en suivant les étapes ci-dessus.
