# Configuration Komodo Dragon

## Moteur d'échecs

Chessr utilise **Komodo Dragon 3.3**, un moteur d'échecs commercial de très haut niveau.

### Versions disponibles

Le dossier `server/engine/` contient plusieurs versions du moteur :

```
server/engine/
├── Linux/
│   ├── dragon-3.3-linux          # x86-64 standard
│   └── dragon-3.3-linux-avx2     # x86-64 optimisé (recommandé)
├── MacOS/
│   ├── dragon-3.3-macos          # x86-64
│   ├── dragon-3.3-macos-avx2     # x86-64 optimisé
│   └── dragon-3.3-macos-m1       # ARM64 (Apple Silicon)
└── Windows/
    ├── dragon-3.3-windows.exe
    └── dragon-3.3-windows-avx2.exe
```

## Configuration Serveur Production

### Architecture requise

- **Serveur**: x86-64 (Intel/AMD)
- **OS**: Ubuntu 24.04.3 LTS
- **CPU**: Doit supporter AVX2 pour la version optimisée
- **Binaire utilisé**: `dragon-3.3-linux` ou `dragon-3.3-linux-avx2`

### Vérification du support AVX2

Sur le serveur de production (91.99.78.172) :

```bash
ssh root@91.99.78.172 "lscpu | grep -i flags | grep -o 'avx2'"
# Output: avx2 ✅
```

**Résultat** : Le serveur supporte AVX2, utilisez la version optimisée.

## Configuration Docker

### Dockerfile (server/Dockerfile)

**IMPORTANT** : Utiliser `node:20-slim` (Debian-based) et **NON** `node:20-alpine`.

```dockerfile
FROM node:20-slim
# Komodo Dragon nécessite glibc (GNU/Linux)
# Alpine utilise musl libc → incompatible
```

### docker-compose.yml

```yaml
services:
  chess-server:
    build:
      context: ./server
      dockerfile: Dockerfile
    ports:
      - "8080:3000"      # Engine WebSocket → Nginx sur 8080
      - "8081:3001"      # Métriques
    volumes:
      - ./server/engine/Linux:/engine:ro
    environment:
      - ENGINE_PATH=/engine/dragon-3.3-linux-avx2  # Version optimisée
```

### Variables d'environnement

| Variable | Valeur | Description |
|----------|--------|-------------|
| `ENGINE_PATH` | `/engine/dragon-3.3-linux-avx2` | Chemin vers le binaire Komodo (recommandé AVX2) |
| `ENGINE_PATH` | `/engine/dragon-3.3-linux` | Version standard si AVX2 non supporté |

## Changement de version

Pour utiliser la version AVX2 optimisée (recommandé) :

1. Modifier `docker-compose.yml` :
```yaml
environment:
  - ENGINE_PATH=/engine/dragon-3.3-linux-avx2
```

2. Rebuild le container :
```bash
docker compose build chess-server
docker compose up -d chess-server
```

## Compatibilité Architecture

### ❌ Incompatible
- Alpine Linux (musl libc)
- ARM64 (serveur actuel était ARM, maintenant x86-64 ✅)
- 32-bit

### ✅ Compatible
- Ubuntu/Debian x86-64 avec glibc
- Node Docker image : `node:20-slim` ou `node:20-bullseye`
- Serveur Hetzner actuel : x86-64 AMD EPYC-Genoa ✅

## Performances

### Optimisations activées en production

Le serveur Chessr utilise plusieurs optimisations :

1. **Binaire optimisé AVX2**
   - ~30% plus rapide que la version standard
   - Utilise les instructions SIMD avancées

2. **Pool d'engines**
   - Réutilisation des instances pour éviter le spawn
   - Configuration dans `server/src/engine-pool.ts`

3. **Hash tables**
   - Warmup des positions via l'historique
   - Améliore la qualité de l'analyse

4. **Personnalités Komodo**
   - Default, Aggressive, Defensive, Active, Positional, Endgame, Beginner, Human
   - Configuré via `setPersonality()`

## Monitoring

### Logs
```bash
# Vérifier que le moteur démarre correctement
docker logs chess-dragon-server | grep -i engine

# Logs Nginx (accès engine)
tail -f /opt/chessr/logs/engine-access.log
```

### Tests
```bash
# Tester le binaire directement
docker exec -it chess-dragon-server /engine/dragon-3.3-linux-avx2
# Devrait afficher:
# Komodo Dragon 3.3 by Komodo Chess
# (Type 'uci' puis 'quit' pour sortir)
```

## Troubleshooting

### Erreur "Failed to start engine"

**Cause** : Binaire incompatible avec l'architecture

**Solutions** :
1. Vérifier architecture : `docker exec chess-dragon-server uname -m`
2. Vérifier glibc : `docker exec chess-dragon-server ldd /engine/dragon-3.3-linux`
3. Si Alpine : changer Dockerfile pour `node:20-slim`

### Erreur "No such file or directory"

**Cause** : Volume non monté ou chemin incorrect

**Solution** :
```bash
# Vérifier que le volume est monté
docker exec chess-dragon-server ls -la /engine/
```

### Performance dégradée

**Solutions** :
1. Utiliser la version AVX2 si supportée
2. Augmenter Hash dans engine-pool
3. Vérifier limites CPU dans docker-compose

## Références

- [Komodo Dragon Documentation officielle](server/engine/KomodoDragon3.3.html)
- Configuration ELO : `server/src/engine.ts` ligne 191-206
- Personnalités : `server/src/engine.ts` ligne 55-64
