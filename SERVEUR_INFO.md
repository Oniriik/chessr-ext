# 🎉 Serveur Chess Stockfish Installé !

Votre serveur est maintenant opérationnel sur OVH.

## 📡 Informations de Connexion

### VPS OVH
- **Nom:** vps-8058cb7f.vps.ovh.net
- **IP:** 135.125.201.246
- **Utilisateur:** ubuntu
- **Mot de passe:** Chess2026SecurePass!
- **SSH:** `ssh ubuntu@135.125.201.246` (clé SSH configurée)

### Serveur Chess Stockfish
- **URL WebSocket:** `ws://135.125.201.246:3000`
- **URL alternative:** `ws://vps-8058cb7f.vps.ovh.net:3000`
- **Port:** 3000
- **Statut:** ✅ Opérationnel
- **Moteurs Stockfish:** 2-8 (auto-scaling)

## 🧪 Test de Connexion

### Installation de wscat (outil de test WebSocket)

```bash
npm install -g wscat
```

### Test rapide

```bash
# Connexion au serveur
wscat -c ws://135.125.201.246:3000

# Après connexion, vous verrez :
< {"type":"ready"}

# Envoyez une requête d'analyse :
> {"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":15,"multiPV":1}

# Vous recevrez des messages d'info puis le meilleur coup
```

### Script de test automatique

```bash
cd /Users/timothe/dev/chess
bash test-connection.sh
```

## 📊 Gestion du Serveur

### Voir les logs en temps réel

```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs -f'
```

### Redémarrer le serveur

```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml restart'
```

### Arrêter le serveur

```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml stop'
```

### Démarrer le serveur

```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml start'
```

### Voir le statut

```bash
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'
```

### Voir l'utilisation des ressources

```bash
ssh ubuntu@135.125.201.246 'docker stats'
```

## 🔄 Mise à Jour du Serveur

Quand vous modifiez le code localement :

```bash
# 1. Transférer les nouveaux fichiers
cd /Users/timothe/dev/chess
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  server/ ubuntu@135.125.201.246:/home/ubuntu/chess-server/

# 2. Rebuild et redémarrer
ssh ubuntu@135.125.201.246 'cd /home/ubuntu/chess-server && docker compose build && docker compose up -d'

# 3. Vérifier les logs
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs --tail=50'
```

## 📝 API WebSocket

### Connexion

```javascript
const ws = new WebSocket('ws://135.125.201.246:3000');

ws.onopen = () => {
  console.log('Connecté !');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Message:', message);
};
```

### Analyser une position

```javascript
ws.send(JSON.stringify({
  type: 'analyze',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  searchMode: 'depth',  // ou 'time'
  depth: 20,            // profondeur de recherche
  moveTime: 1000,       // temps en ms (si searchMode = 'time')
  multiPV: 3,           // nombre de variations (1-5)
  elo: 2000,            // niveau ELO (optionnel, 500-3000)
  mode: 'balanced'      // 'balanced', 'aggressive', 'positional'
}));
```

### Messages reçus

#### Ready (à la connexion)
```json
{"type":"ready"}
```

#### Info (pendant l'analyse)
```json
{
  "type": "info",
  "depth": 15,
  "score": {"type": "cp", "value": 50},
  "pv": ["e2e4", "e7e5", "g1f3"],
  "nodes": 1234567,
  "nps": 500000,
  "time": 2468,
  "multiPv": 1
}
```

#### Best Move (résultat final)
```json
{
  "type": "bestmove",
  "bestMove": "e2e4",
  "ponder": "e7e5"
}
```

## 🔐 Sécurité

### Firewall configuré
- ✅ Port 22 (SSH) ouvert
- ✅ Port 3000 (Chess Server) ouvert

### Recommandations
- 🔑 SSH par clé (configuré)
- 🔒 Mot de passe changé
- 🛡️ Firewall UFW activé

### Pour ajouter SSL/HTTPS (optionnel)

Si vous voulez sécuriser avec un domaine et SSL :

1. Pointez un domaine vers `135.125.201.246`
2. Lancez le script de configuration Nginx :

```bash
bash scripts/setup-nginx-ovh.sh votre-domaine.com
```

## 📈 Performance

Le serveur actuel peut gérer :
- **Connexions simultanées:** 50+
- **Analyses/seconde:** 20+
- **Pool de moteurs:** 2 minimum, 8 maximum (auto-scaling)

## 🆘 Dépannage

### Le serveur ne répond pas

```bash
# Vérifier le statut
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'

# Redémarrer
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml restart'

# Voir les erreurs
ssh ubuntu@135.125.201.246 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs --tail=100'
```

### Impossible de se connecter en SSH

```bash
ssh -v ubuntu@135.125.201.246
```

### Le firewall bloque

```bash
ssh ubuntu@135.125.201.246 'sudo ufw status'
ssh ubuntu@135.125.201.246 'sudo ufw allow 3000/tcp'
```

## 📚 Documentation

- [Guide complet Docker](DEPLOYMENT_DOCKER.md)
- [Documentation API](server/README.md)
- [Scripts d'installation](scripts/README.md)

## ✅ Checklist de Production

- [x] Serveur installé et fonctionnel
- [x] Docker configuré
- [x] Stockfish opérationnel
- [x] Firewall configuré
- [x] SSH sécurisé avec clé
- [x] Pool de moteurs (2-8)
- [x] Tests de connexion réussis
- [ ] Domaine configuré (optionnel)
- [ ] SSL/TLS activé (optionnel)
- [ ] Monitoring en place (optionnel)

---

**🎉 Votre serveur Chess Stockfish est prêt à l'emploi !**

Pour toute question, consultez la documentation ou testez avec :
```bash
bash test-connection.sh
```
