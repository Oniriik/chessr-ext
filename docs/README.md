# Documentation Chessr

Documentation complète du projet Chessr, organisée par composants.

## Structure

### 📁 [server/](./server/)
Documentation relative au serveur de production :
- Configuration serveur
- Déploiement
- Maintenance
- Monitoring

### 📁 [dashboard/](./dashboard/)
Documentation du dashboard web :
- Architecture
- Configuration
- API endpoints
- Déploiement

### 📁 [extension/](./extension/)
Documentation de l'extension navigateur :
- Installation
- Configuration
- Architecture
- Build & Release

## Documents Principaux

### Serveur
- [Informations Serveur](./server/SERVER_INFO.md) - Spécifications, accès SSH, ressources
- [Configuration Nginx](./server/NGINX_CONFIG.md) - Reverse proxy, SSL, domaines
- [Configuration Komodo Dragon](./server/KOMODO_CONFIG.md) - Moteur d'échecs, compatibilité, optimisations

## Convention

- Tous les fichiers de documentation sont en Markdown (.md)
- Les commandes shell sont dans des blocs de code
- Les informations sensibles (mots de passe, tokens) ne sont jamais commitées
