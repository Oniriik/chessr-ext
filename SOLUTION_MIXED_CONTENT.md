# 🔒 Solution au Problème Mixed Content

## ❌ Le Problème

```
Mixed Content: The page at 'https://www.chess.com/play/computer' was loaded over HTTPS,
but attempted to connect to the insecure WebSocket endpoint 'ws://135.125.201.246:3000/'.
This request has been blocked; this endpoint must be available over WSS.
```

**Explication :** chess.com est en HTTPS (sécurisé) et votre serveur utilise WS (non sécurisé). Les navigateurs bloquent les connexions non sécurisées depuis des pages sécurisées.

## ✅ Solutions

---

## 🚀 Solution 1 : Test Temporaire (5 minutes)

**Pour tester l'extension MAINTENANT sans SSL :**

### Méthode A : Autoriser le contenu mixte dans Chrome

1. Allez sur chess.com
2. Cliquez sur l'icône **🔒** (ou ⓘ) à gauche de l'URL
3. Cliquez sur **"Paramètres du site"**
4. Cherchez **"Contenu non sécurisé"**
5. Changez en **"Autoriser"**
6. Rechargez la page

### Méthode B : Flag Chrome (Plus simple)

1. **Fermez TOUS les onglets Chrome**
2. Lancez Chrome avec cette commande :

**Sur Mac :**
```bash
open -a "Google Chrome" --args --allow-running-insecure-content --unsafely-treat-insecure-origin-as-secure="ws://135.125.201.246:3000"
```

**Sur Windows :**
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --allow-running-insecure-content --unsafely-treat-insecure-origin-as-secure="ws://135.125.201.246:3000"
```

**Sur Linux :**
```bash
google-chrome --allow-running-insecure-content --unsafely-treat-insecure-origin-as-secure="ws://135.125.201.246:3000"
```

3. Allez sur chess.com
4. L'extension devrait maintenant se connecter !

⚠️ **Attention :** Cette méthode est UNIQUEMENT pour les tests. Ne l'utilisez pas en production.

---

## 🔐 Solution 2 : SSL avec Certificat Auto-Signé (30 minutes)

**Pour une vraie solution sans domaine :**

Je configure Nginx avec SSL sur le VPS. Le navigateur avertira que le certificat n'est pas vérifié, mais vous pourrez accepter l'exception.

**Avantages :**
- ✅ Connexion chiffrée (wss://)
- ✅ Fonctionne sans domaine
- ✅ Pas de flags Chrome bizarres

**Inconvénients :**
- ⚠️ Avertissement du navigateur (accepter manuellement)
- ⚠️ Pas idéal pour distribuer l'extension

**Commandes à lancer :**
```bash
# Je configure tout pour vous
bash scripts/setup-ssl-self-signed.sh
```

---

## 🌐 Solution 3 : SSL avec Let's Encrypt (1 heure, Production)

**Pour une vraie solution en production :**

Si vous avez (ou achetez) un nom de domaine :

1. **Configurer le DNS :**
   - Créez un enregistrement A : `chess.votre-domaine.com` → `135.125.201.246`

2. **Configurer SSL :**
   ```bash
   bash scripts/setup-ssl-domain.sh chess.votre-domaine.com
   ```

3. **Rebuild l'extension :**
   ```bash
   cd extension
   # Modifier .env.production
   echo 'STOCKFISH_SERVER_URL=wss://chess.votre-domaine.com' > .env.production
   npm run build:prod
   ```

**Avantages :**
- ✅ SSL valide et reconnu
- ✅ Aucun avertissement
- ✅ Idéal pour production
- ✅ Certificat gratuit et auto-renouvelé

**Coût domaine :** ~10-15€/an

---

## 🎯 Quelle Solution Choisir ?

| Solution | Temps | Sécurité | Production | Domaine Requis |
|----------|-------|----------|------------|----------------|
| **Test Temporaire** | 2 min | ⚠️ Faible | ❌ Non | ❌ Non |
| **Certificat Auto-Signé** | 30 min | ✅ Moyenne | ⚠️ Limité | ❌ Non |
| **Let's Encrypt** | 1h | ✅ Haute | ✅ Oui | ✅ Oui |

---

## 💡 Ma Recommandation

### Pour Tester MAINTENANT :
→ **Solution 1 (Flag Chrome)** - Lancez Chrome avec le flag

### Pour Usage Personnel :
→ **Solution 2 (Certificat Auto-Signé)** - Je configure pour vous

### Pour Production/Distribution :
→ **Solution 3 (Domaine + Let's Encrypt)** - Achetez un domaine

---

## 🚀 Actions Rapides

### Je veux tester MAINTENANT (2 minutes)

**Sur Mac :**
```bash
# Fermez Chrome
pkill -a "Google Chrome"

# Relancez avec le flag
open -a "Google Chrome" --args --unsafely-treat-insecure-origin-as-secure="ws://135.125.201.246:3000"
```

Allez sur chess.com et testez l'extension !

### Je veux une vraie solution (30 minutes)

Dites-moi et je configure Nginx avec SSL auto-signé.

### J'ai un domaine

Donnez-moi le nom de domaine et je configure Let's Encrypt.

---

## ❓ FAQ

**Q : Pourquoi ce problème n'existait pas en local ?**
R : En local, vous testez probablement sur `http://localhost` (non HTTPS), donc pas de mixed content.

**Q : Est-ce que le flag Chrome est dangereux ?**
R : Pour les tests, non. Mais ne l'utilisez pas pour naviguer normalement sur Internet.

**Q : Combien coûte un domaine ?**
R : ~10-15€/an. Fournisseurs : Namecheap, OVH, Cloudflare, etc.

**Q : Puis-je utiliser le domaine OVH (vps-8058cb7f.vps.ovh.net) ?**
R : Non, vous ne contrôlez pas ce domaine, donc impossible d'obtenir un certificat SSL pour celui-ci.
