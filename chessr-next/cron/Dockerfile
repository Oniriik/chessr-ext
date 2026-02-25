# Chessr Cron Service
# Runs periodic tasks like plan expiration checks

FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json ./

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Create cron job: run every 10 minutes
# Output to stdout/stderr so docker logs can capture it
RUN echo "*/10 * * * * cd /app && pnpm check-expirations > /proc/1/fd/1 2>/proc/1/fd/2" > /etc/crontabs/root

# Run crond in foreground
CMD ["crond", "-f", "-l", "2"]
