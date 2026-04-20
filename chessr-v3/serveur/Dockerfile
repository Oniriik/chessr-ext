FROM node:20-slim

WORKDIR /app

# OS deps for Dragon binaries (Linux build expects glibc + libc6, already on slim)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . ./

# Ensure the Linux engine binary is executable at runtime
RUN chmod +x /app/engines/linux/dragon-avx2 2>/dev/null || true

ENV NODE_ENV=production
EXPOSE 8081

CMD ["npx", "tsx", "src/index.ts"]
