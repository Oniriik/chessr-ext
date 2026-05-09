# Multi-stage so the runtime image carries only the compiled output —
# no TS source, no devDeps, no node_modules with @types/*.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ─── runtime ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
# `--omit=dev` strips typescript / @types/node / tsx from the runtime tree.
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
