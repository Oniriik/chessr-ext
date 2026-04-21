FROM node:20-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . ./

ENV NODE_ENV=production
EXPOSE 8081

CMD ["npx", "tsx", "src/index.ts"]
