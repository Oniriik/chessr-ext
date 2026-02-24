# Chessr Server Dockerfile
# Multi-stage build for smaller image

FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile || npm ci

# Copy source
COPY . .

# Build TypeScript (if needed for production)
RUN npm run build 2>/dev/null || echo "No build step"

# ============================================
# Production image
# ============================================
FROM node:20-slim AS runner

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src

# Copy chess engines (pre-compiled Linux binaries)
COPY engines/linux ./engines/linux

# Copy Syzygy tablebases (optional, for endgame analysis)
# Comment out if not needed to reduce image size (~1GB)
COPY engines/syzygy ./engines/syzygy

# Make engines executable
RUN chmod +x ./engines/linux/*

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose WebSocket port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const ws = new (require('ws'))('ws://localhost:8080'); ws.on('open', () => process.exit(0)); ws.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 5000);"

# Start server
CMD ["pnpm", "start"]
