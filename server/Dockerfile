FROM node:20-alpine

# Installation de Stockfish - compiler depuis les sources car pas disponible dans apk
RUN apk add --no-cache git make g++ && \
    cd /tmp && \
    git clone --depth 1 --branch sf_16.1 https://github.com/official-stockfish/Stockfish.git && \
    cd Stockfish/src && \
    make -j $(nproc) build ARCH=x86-64-modern && \
    cp stockfish /usr/local/bin/ && \
    cd / && \
    rm -rf /tmp/Stockfish && \
    apk del git make g++

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
