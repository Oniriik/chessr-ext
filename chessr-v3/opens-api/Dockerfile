FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc --outDir dist

# ---- runtime ----
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p data

ENV PORT=3900
ENV NODE_ENV=production

EXPOSE 3900

# Seed DB on first boot if absent, then start server.
CMD ["sh", "-c", "test -f data/openings.db || node dist/seed.js; node dist/index.js"]
