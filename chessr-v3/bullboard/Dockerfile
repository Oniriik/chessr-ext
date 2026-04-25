FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY index.mjs ./
EXPOSE 3000
CMD ["node", "index.mjs"]
