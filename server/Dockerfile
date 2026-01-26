FROM node:20-alpine

# Chess engine (Komodo Dragon) is mounted at runtime via docker-compose
# No compilation needed - the engine binary is provided externally

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
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Démarrage de l'application
CMD ["node", "dist/index.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
