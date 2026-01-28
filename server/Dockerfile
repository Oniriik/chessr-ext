FROM node:20-slim

# Chess engine (Komodo Dragon) is mounted at runtime via docker-compose
# Using node:20-slim (Debian-based) instead of Alpine for glibc compatibility
# Komodo Dragon Linux binary requires GNU/Linux glibc, not musl libc

# Création du répertoire de travail
WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation de toutes les dépendances (dev incluses pour le build)
RUN npm ci && npm cache clean --force

# Copie des fichiers source
COPY . .

# Build du projet TypeScript
RUN npm run build

# Nettoyage des devDependencies après le build
RUN npm prune --production

# Exposition du port
EXPOSE 3000

# Utilisateur non-root pour la sécurité
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Démarrage de l'application
CMD ["node", "dist/index.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
