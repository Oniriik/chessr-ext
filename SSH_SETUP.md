# Configuration SSH pour VPS

Guide pour générer et configurer vos clés SSH pour accéder à votre VPS.

## Étape 1 : Vérifier si vous avez déjà une clé SSH

Sur votre Mac :

```bash
# Vérifier si vous avez déjà des clés SSH
ls -la ~/.ssh/
```

Si vous voyez des fichiers `id_rsa` et `id_rsa.pub` (ou `id_ed25519` et `id_ed25519.pub`), vous avez déjà une clé SSH.

## Étape 2 : Générer une nouvelle clé SSH (si nécessaire)

### Méthode 1 : Clé Ed25519 (Recommandée - Plus sécurisée)

```bash
# Générer une nouvelle clé Ed25519
ssh-keygen -t ed25519 -C "votre-email@example.com"

# Appuyez sur Entrée pour accepter l'emplacement par défaut (~/.ssh/id_ed25519)
# Entrez un mot de passe sécurisé (optionnel mais recommandé)
```

### Méthode 2 : Clé RSA (Compatible avec anciens systèmes)

```bash
# Générer une nouvelle clé RSA 4096 bits
ssh-keygen -t rsa -b 4096 -C "votre-email@example.com"

# Appuyez sur Entrée pour accepter l'emplacement par défaut (~/.ssh/id_rsa)
# Entrez un mot de passe sécurisé (optionnel mais recommandé)
```

Vous verrez quelque chose comme :

```
Generating public/private ed25519 key pair.
Enter file in which to save the key (/Users/timothe/.ssh/id_ed25519): [Appuyez sur Entrée]
Enter passphrase (empty for no passphrase): [Tapez votre mot de passe ou Entrée]
Enter same passphrase again: [Répétez le mot de passe]
Your identification has been saved in /Users/timothe/.ssh/id_ed25519
Your public key has been saved in /Users/timothe/.ssh/id_ed25519.pub
```

## Étape 3 : Afficher votre clé publique

```bash
# Pour Ed25519
cat ~/.ssh/id_ed25519.pub

# Pour RSA
cat ~/.ssh/id_rsa.pub
```

Vous verrez quelque chose comme :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl3dIeudNqd0DMXX8JO+J2jtQ+v3P3Y8qXKHZ/4Xh0E votre-email@example.com
```

**IMPORTANT :** C'est la clé **publique** qui se termine par `.pub` qu'il faut copier. Ne partagez JAMAIS la clé privée (sans `.pub`).

## Étape 4 : Copier la clé vers le VPS

### Méthode A : ssh-copy-id (Plus simple)

Si votre VPS accepte encore les connexions par mot de passe :

```bash
# Pour Ed25519
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@votre-ip-vps

# Pour RSA
ssh-copy-id -i ~/.ssh/id_rsa.pub root@votre-ip-vps

# Entrez le mot de passe du VPS quand demandé
```

### Méthode B : Copier manuellement

Si votre VPS vous demande d'entrer la clé via un panneau de contrôle :

1. **Copiez la clé publique** :

```bash
# Pour Ed25519
cat ~/.ssh/id_ed25519.pub | pbcopy

# Pour RSA
cat ~/.ssh/id_rsa.pub | pbcopy

# La clé est maintenant dans votre presse-papiers
```

2. **Collez la clé dans le panneau de contrôle de votre VPS**
   - Allez dans le panneau de contrôle de votre fournisseur VPS
   - Cherchez "SSH Keys" ou "Clés SSH"
   - Cliquez sur "Add SSH Key" ou "Ajouter une clé SSH"
   - Collez la clé copiée (Cmd+V)
   - Donnez-lui un nom (ex: "MacBook-2026")
   - Sauvegardez

### Méthode C : Connexion initiale et ajout manuel

Si vous pouvez déjà vous connecter avec un mot de passe :

```bash
# Connectez-vous au VPS
ssh root@votre-ip-vps
# Entrez le mot de passe

# Sur le VPS, créez le dossier .ssh s'il n'existe pas
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Sur votre Mac (dans un autre terminal), copiez la clé
# Pour Ed25519
cat ~/.ssh/id_ed25519.pub | ssh root@votre-ip-vps "cat >> ~/.ssh/authorized_keys"

# Pour RSA
cat ~/.ssh/id_rsa.pub | ssh root@votre-ip-vps "cat >> ~/.ssh/authorized_keys"

# Sur le VPS, ajustez les permissions
ssh root@votre-ip-vps "chmod 600 ~/.ssh/authorized_keys"
```

## Étape 5 : Tester la connexion

```bash
# Testez la connexion sans mot de passe
ssh root@votre-ip-vps

# Vous devriez vous connecter sans mot de passe
# (ou avec votre passphrase si vous en avez défini une)
```

## Étape 6 : Configuration pour plusieurs VPS (Optionnel)

Si vous avez plusieurs VPS ou souhaitez utiliser des noms faciles à retenir :

```bash
# Créer/éditer le fichier de config SSH
nano ~/.ssh/config
```

Ajoutez :

```
Host mon-chess-server
    HostName votre-ip-vps
    User root
    IdentityFile ~/.ssh/id_ed25519
    Port 22

Host autre-serveur
    HostName autre-ip
    User username
    IdentityFile ~/.ssh/id_ed25519
```

Maintenant vous pouvez vous connecter avec :

```bash
ssh mon-chess-server
```

## Étape 7 : Sécuriser le VPS (Après connexion réussie)

Une fois que vous pouvez vous connecter avec SSH :

```bash
# Connectez-vous au VPS
ssh root@votre-ip-vps

# Désactiver l'authentification par mot de passe
nano /etc/ssh/sshd_config
```

Modifiez ces lignes :

```
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

Redémarrez SSH :

```bash
systemctl restart sshd
```

## Dépannage

### "Permission denied (publickey)"

Vérifiez les permissions :

```bash
# Sur votre Mac
chmod 700 ~/.ssh
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub

# Sur le VPS
ssh root@votre-ip-vps "chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

### "Connection refused"

Vérifiez que le service SSH fonctionne sur le VPS :

```bash
ssh root@votre-ip-vps "systemctl status sshd"
```

### La clé ne fonctionne pas

Vérifiez que la bonne clé est utilisée :

```bash
ssh -v root@votre-ip-vps
# Le mode verbose (-v) affiche les détails de la connexion
```

### Réinitialiser et recommencer

```bash
# Sur le VPS, videz authorized_keys
ssh root@votre-ip-vps "echo '' > ~/.ssh/authorized_keys"

# Recommencez l'étape 4
```

## Fournisseurs VPS Populaires

### DigitalOcean

1. Allez dans "Settings" → "Security" → "SSH Keys"
2. Cliquez "Add SSH Key"
3. Collez votre clé publique
4. Lors de la création du Droplet, sélectionnez votre clé

### OVH

1. Allez dans "Public Cloud" → "SSH Keys"
2. Cliquez "Ajouter une clé"
3. Collez votre clé publique
4. Lors de la création de l'instance, sélectionnez votre clé

### Hetzner

1. Allez dans "Security" → "SSH Keys"
2. Cliquez "Add SSH Key"
3. Collez votre clé publique
4. Lors de la création du serveur, sélectionnez votre clé

### AWS (EC2)

AWS gère les clés différemment, ils vous fournissent une clé `.pem` à télécharger lors de la création.

### Contabo / Autres

Généralement via le panneau de contrôle ou en ajoutant manuellement (Méthode C).

## Commandes Rapides de Référence

```bash
# Générer une clé
ssh-keygen -t ed25519 -C "email@example.com"

# Afficher la clé publique
cat ~/.ssh/id_ed25519.pub

# Copier dans le presse-papiers
cat ~/.ssh/id_ed25519.pub | pbcopy

# Copier vers le VPS
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@IP

# Tester la connexion
ssh root@IP

# Connexion avec clé spécifique
ssh -i ~/.ssh/id_ed25519 root@IP
```

## Prochaines Étapes

Une fois connecté au VPS avec SSH, suivez le guide [QUICK_START.md](QUICK_START.md) pour installer le serveur Chess Stockfish.
