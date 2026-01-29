# Serveur Chessr - Informations

## Spécifications Techniques

- **Provider**: Hetzner Cloud
- **IP**: 91.99.78.172
- **Hostname**: chessr
- **OS**: Ubuntu 24.04.3 LTS (Noble Numbat)
- **Architecture**: x86_64 (AMD EPYC-Genoa)
- **Ressources**:
  - CPU: 8 vCPU
  - RAM: 16 GB
  - Disque: 301 GB (local)

## Accès SSH

### Connexion
```bash
ssh root@91.99.78.172
```

### Clé SSH Autorisée
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfQlmiB9DTZ2V455+7v0lU2znIKo6twefTvFHBB5P3b timothe@lempire.co
```

### Utilisateur
- **Username**: root
- **Authentification**: SSH key uniquement (pas de mot de passe)

## Logiciels Installés

- [x] **Docker**: 29.2.0
- [x] **Docker Compose**: v5.0.2
- [x] **Nginx**: 1.24.0 (Ubuntu) - actif
- [x] **UFW (firewall)**: Activé et configuré
- [x] **Git**: 2.43.0
- [x] **Certbot**: 2.9.0 (Let's Encrypt)
- [x] **Outils**: vim, htop, unzip

## Configuration Firewall (UFW)

Ports ouverts :
- **22/tcp**: SSH
- **80/tcp**: HTTP (Nginx)
- **443/tcp**: HTTPS (Nginx)

Status: **Actif** et démarré au boot

## Structure des Répertoires

```
/opt/chessr/
├── app/           # Code source Git (dashboard, server, docker-compose.yml)
├── extension/     # Fichiers extension (.zip) pour distribution
├── nginx/         # Configuration Nginx personnalisée
├── ssl/           # Certificats SSL
├── logs/          # Logs applicatifs
├── docs/          # Documentation (copie de docs/)
└── backups/       # Backups
```

**Détail du répertoire app/** :
```
/opt/chessr/app/   # Repository Git: github.com/Oniriik/chessr-ext
├── dashboard/     # Code source Next.js
├── server/        # Code source Node.js (WebSocket + Komodo)
├── extension/     # Code source extension navigateur
├── docker-compose.yml
├── .env
└── ...
```

## État des Services

- **Nginx**: Active et en cours d'exécution
- **Docker**: Installé et prêt
- **UFW**: Actif avec règles configurées
- **Certbot Timer**: Actif pour renouvellement auto des certificats

## Utilisation Disque

- **Capacité totale**: 150 GB
- **Utilisé**: 1.9 GB (2%)
- **Disponible**: 142 GB

## Ressources Système

- **RAM totale**: 15 GB
- **RAM utilisée**: ~500 MB
- **RAM disponible**: ~14 GB
- **Swap**: Désactivé

## Domaines

- **dashboard.chessr.io** → Dashboard web (HTTPS actif ✓)
- **engine.chessr.io** → WebSocket server Komodo (HTTPS actif ✓)
- **download.chessr.io** → Distribution extension navigateur (HTTPS actif ✓)

### Configuration DNS (Active)

```
Type    Nom/Host          Valeur/Target      TTL
─────────────────────────────────────────────────
A       dashboard         91.99.78.172       3600
A       engine            91.99.78.172       3600
A       download          91.99.78.172       3600
```

### SSL/TLS

- **Certificats**: Let's Encrypt (ECDSA)
- **Domaines couverts**: dashboard.chessr.io, engine.chessr.io, download.chessr.io
- **Expiration**: 2026-04-28
- **Renouvellement**: Automatique (Certbot timer)
- **Statut**: ✅ Valides et actifs

## Nginx

- **Version**: 1.24.0 (Ubuntu)
- **Configuration**: Reverse proxy pour dashboard, engine et serveur de fichiers statiques
- **Backends**:
  - Dashboard: `localhost:3000` (proxy vers container)
  - Engine: `localhost:8080` (proxy WebSocket vers container)
  - Download: `/opt/chessr/extension` (fichiers statiques)
- **Logs**: `/opt/chessr/logs/`
- **Documentation**: Voir [NGINX_CONFIG.md](./NGINX_CONFIG.md)

## Notes

- Serveur provisionné le: 2026-01-28
- Setup initial complété le: 2026-01-28
- Migration depuis l'ancien serveur en cours
- Ce serveur remplace la configuration actuelle de chessr
- Repository GitHub: https://github.com/Oniriik/chessr-ext
