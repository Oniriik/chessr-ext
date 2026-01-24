# 📝 ChessR - Aide-Mémoire Rapide

Commandes essentielles pour gérer le serveur ChessR au quotidien.

---

## 🔐 Connexion Serveur

```bash
# Connexion SSH interactive
./ssh-connect.sh

# Exécuter une commande
./ssh-connect.sh "commande"
```

**Serveur:** ubuntu@135.125.201.246
**Mot de passe:** Chess2026SecurePass!

---

## 🛠️ Scripts Essentiels

```bash
# Déployer une nouvelle version
./deploy-server.sh

# Redémarrer le serveur
./restart-remote-server.sh

# Vérifier l'état
./check-server-status.sh

# Voir les logs (30 dernières lignes)
./view-remote-logs.sh

# Voir les logs (100 dernières lignes)
./view-remote-logs.sh 100

# Suivre les logs en temps réel
./follow-remote-logs.sh
```

---

## 🧪 Tests

```bash
# Test simple
node test-remote-server.js

# Test détaillé
node test-remote-debug.js

# Test bash
./test-connection.sh
```

---

## 🐳 Docker (sur le serveur)

```bash
# Voir les conteneurs
./ssh-connect.sh "sudo docker ps"

# Logs du serveur
./ssh-connect.sh "sudo docker logs chess-stockfish-server"

# Logs en temps réel
./ssh-connect.sh "sudo docker logs -f chess-stockfish-server"

# Stats CPU/RAM
./ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"

# Redémarrer le conteneur
./ssh-connect.sh "cd /home/ubuntu/chess-server && sudo docker compose restart"

# Rebuild complet
./ssh-connect.sh "cd /home/ubuntu/chess-server && sudo docker compose up --build -d"

# Arrêter le serveur
./ssh-connect.sh "cd /home/ubuntu/chess-server && sudo docker compose down"

# Nettoyer Docker
./ssh-connect.sh "sudo docker system prune -af"
```

---

## 🔍 Diagnostic

```bash
# Vérification complète
./check-server-status.sh

# Rechercher des erreurs dans les logs
./view-remote-logs.sh 200 | grep -i error

# Voir les connexions actives
./view-remote-logs.sh | grep "Client connected"

# Voir les analyses en cours
./view-remote-logs.sh | grep "Starting analysis"

# Vérifier l'espace disque
./ssh-connect.sh "df -h"

# Vérifier la RAM
./ssh-connect.sh "free -h"
```

---

## 🚨 Dépannage Rapide

### Le serveur ne répond pas
```bash
./check-server-status.sh
./view-remote-logs.sh 50
./restart-remote-server.sh
```

### Erreur persistante
```bash
./view-remote-logs.sh 100
./deploy-server.sh
```

### Serveur bloqué sur une analyse
```bash
./view-remote-logs.sh | grep -i timeout
./restart-remote-server.sh
```

### Manque d'espace disque
```bash
./ssh-connect.sh "sudo docker system prune -af"
./ssh-connect.sh "sudo journalctl --vacuum-time=7d"
```

---

## 📊 Monitoring

```bash
# Terminal 1: Logs en continu
./follow-remote-logs.sh

# Terminal 2: Stats toutes les 5s
watch -n 5 './ssh-connect.sh "sudo docker stats chess-stockfish-server --no-stream"'
```

---

## 🔄 Workflow Développement

### Modifier et déployer le serveur
```bash
cd server/src
# ... modifications ...
cd ..
npm run build
cd ..
./deploy-server.sh
./check-server-status.sh
```

### Modifier l'extension
```bash
cd extension/src
# ... modifications ...
cd ..
npm run build:prod
# Recharger l'extension dans Chrome
```

### Tester l'intégration
```bash
node test-remote-debug.js
./follow-remote-logs.sh
```

---

## 📁 Fichiers Serveur

```bash
# Voir les fichiers serveur
./ssh-connect.sh "ls -la /home/ubuntu/chess-server"

# Voir le docker-compose.yml
./ssh-connect.sh "cat /home/ubuntu/chess-server/docker-compose.yml"

# Voir le Dockerfile
./ssh-connect.sh "cat /home/ubuntu/chess-server/Dockerfile"

# Voir les variables d'environnement
./ssh-connect.sh "cat /home/ubuntu/chess-server/.env"
```

---

## 🌐 URLs et Endpoints

| Endpoint | URL |
|----------|-----|
| **WebSocket Production** | wss://ws.chessr.io |
| **WebSocket Direct** | ws://135.125.201.246:3000 |
| **Landing Page** | https://chessr.io |
| **SSH** | ubuntu@135.125.201.246 |

---

## 🔧 Commandes Nginx

```bash
# Tester la config
./ssh-connect.sh "sudo nginx -t"

# Recharger Nginx
./ssh-connect.sh "sudo systemctl reload nginx"

# Voir la config
./ssh-connect.sh "cat /etc/nginx/sites-available/chessr.io"

# Logs Nginx
./ssh-connect.sh "sudo tail -f /var/log/nginx/error.log"
```

---

## 🔥 Firewall

```bash
# Statut du firewall
./ssh-connect.sh "sudo ufw status"

# Ouvrir un port
./ssh-connect.sh "sudo ufw allow 3000/tcp"

# Voir les règles
./ssh-connect.sh "sudo ufw status numbered"
```

---

## 🎯 Raccourcis Utiles

```bash
# Tout redémarrer rapidement
./restart-remote-server.sh && sleep 5 && ./check-server-status.sh

# Voir ce qui se passe maintenant
./follow-remote-logs.sh

# Déployer et vérifier
./deploy-server.sh && ./check-server-status.sh

# Stats complètes
./ssh-connect.sh "sudo docker stats --no-stream && df -h && free -h"
```

---

## 📖 Documentation Complète

- **Documentation centrale:** [DOCUMENTATION.md](DOCUMENTATION.md)
- **Scripts détaillés:** [SERVER_SCRIPTS.md](SERVER_SCRIPTS.md)
- **Infos serveur:** [SERVEUR_INFO.md](SERVEUR_INFO.md)

---

**💡 Astuce:** Gardez ce fichier ouvert dans un onglet pour un accès rapide aux commandes !
