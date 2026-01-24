# 🔒 Accepter le Certificat SSL Auto-Signé

## ⚠️ Pourquoi cette étape est nécessaire ?

Chrome bloque automatiquement les connexions WebSocket vers des serveurs avec des certificats SSL non reconnus (auto-signés). Pour que l'extension puisse se connecter, vous devez d'abord **accepter manuellement** le certificat.

**C'est une étape obligatoire et unique.** Une fois accepté, vous n'aurez plus à le refaire.

---

## 📋 ÉTAPES DÉTAILLÉES

### Étape 1 : Ouvrir l'URL du serveur

1. **Nouvel onglet Chrome**
2. **Tapez dans la barre d'adresse :**
   ```
   https://135.125.201.246
   ```
3. **Appuyez sur Entrée**

---

### Étape 2 : Page d'avertissement

Vous verrez une page comme celle-ci :

```
⚠️ Votre connexion n'est pas privée

Des pirates informatiques essaient peut-être de dérober vos
informations sur 135.125.201.246 (par exemple, mots de passe,
messages ou cartes de crédit).

NET::ERR_CERT_AUTHORITY_INVALID
```

**C'EST NORMAL !** Ce n'est pas une vraie attaque, c'est juste que Chrome ne reconnaît pas notre certificat auto-signé.

---

### Étape 3 : Cliquer sur "Paramètres avancés"

En bas de la page d'avertissement, cliquez sur :
- **"Paramètres avancés"** (français)
- **"Advanced"** (anglais)

---

### Étape 4 : Continuer vers le site

Après avoir cliqué sur "Paramètres avancés", un nouveau lien apparaît :

- **"Continuer vers 135.125.201.246 (dangereux)"** (français)
- **"Proceed to 135.125.201.246 (unsafe)"** (anglais)

**Cliquez dessus.**

---

### Étape 5 : Page de résultat

Vous devriez voir :

**Option A - Page de bienvenue du serveur :**
```
Upgrade Required
```
ou
```
Bad Request
```

**Option B - Page vide ou erreur 502**

**Les deux sont NORMAUX !** L'important c'est que la page se charge sans re-afficher l'avertissement de sécurité.

✅ **Le certificat est maintenant accepté !**

---

### Étape 6 : Tester l'extension

1. **Retournez sur** : https://chess.com
2. **Rechargez la page** (Cmd+R ou F5)
3. **Ouvrez la console** (F12)
4. **Vérifiez les logs :**

```
[Chessr Config] { serverUrl: "wss://135.125.201.246", ... }
WebSocket connecting to wss://135.125.201.246
WebSocket connected
< {"type":"ready"}
```

✅ **Si vous voyez ces messages, ça marche !**

---

## 🔍 Vérification Rapide

### Dans la console, vous devriez voir :

✅ **SUCCÈS :**
```
WebSocket connecting to wss://135.125.201.246
WebSocket connected
< {"type":"ready"}
```

❌ **ÉCHEC (certificat pas accepté) :**
```
WebSocket connection to 'wss://135.125.201.246/' failed:
```

---

## 🐛 Dépannage

### ❌ Je ne vois pas "Paramètres avancés"

**Solution :** Tapez `thisisunsafe` pendant que vous êtes sur la page d'avertissement (sans cliquer nulle part). Chrome acceptera automatiquement le certificat.

### ❌ La page me redirige vers HTTP

**Solution :** Assurez-vous de taper **`https://`** et pas juste `135.125.201.246`

### ❌ Erreur "Connection Refused"

**Vérifier que Nginx fonctionne :**
```bash
ssh ubuntu@135.125.201.246 'sudo systemctl status nginx'
```

Si Nginx n'est pas actif :
```bash
ssh ubuntu@135.125.201.246 'sudo systemctl start nginx'
```

### ❌ L'avertissement réapparaît à chaque fois

**Solution :** Vous devez accepter le certificat dans le **même profil Chrome** que celui où l'extension est installée.

Si vous utilisez plusieurs profils Chrome :
1. Ouvrez le profil où l'extension est installée
2. Acceptez le certificat dans CE profil
3. Testez sur chess.com dans CE même profil

---

## 📸 À Quoi S'Attendre

### Page d'avertissement :

```
🔴 Connexion non privée

NET::ERR_CERT_AUTHORITY_INVALID

[Retour] [Paramètres avancés]
```

Après "Paramètres avancés" :

```
🔴 Connexion non privée

Cette connexion n'est pas privée...

[Continuer vers 135.125.201.246 (dangereux)]
```

### Après avoir accepté :

```
✅ Page chargée (même si erreur 502 ou "Bad Request")
```

---

## 🎯 Checklist

- [ ] Ouvrir https://135.125.201.246
- [ ] Voir l'avertissement de sécurité
- [ ] Cliquer "Paramètres avancés"
- [ ] Cliquer "Continuer vers..."
- [ ] Page chargée (erreur 502 OK)
- [ ] Retour sur chess.com
- [ ] Recharger la page
- [ ] Console → Voir "WebSocket connected"

---

## 💡 Astuce

Si vous devez accepter le certificat souvent (par exemple après redémarrage de Chrome), vous pouvez créer un raccourci ou un bookmark vers `https://135.125.201.246` pour l'accepter rapidement.

---

## ⚠️ Note de Sécurité

**Ce certificat auto-signé est sûr** car :
- ✅ C'est VOTRE serveur
- ✅ Vous l'avez créé vous-même
- ✅ La connexion est chiffrée (SSL/TLS)
- ✅ Personne d'autre ne contrôle ce serveur

Le seul "problème" c'est que Chrome ne reconnaît pas l'autorité qui a émis le certificat (car c'est vous).

Pour éviter cet avertissement en production, il faudrait :
1. Acheter un domaine
2. Utiliser Let's Encrypt (certificat gratuit et reconnu)

---

**🔒 Une fois le certificat accepté, vous n'aurez plus à le refaire !**

Retournez sur chess.com et testez l'extension.
