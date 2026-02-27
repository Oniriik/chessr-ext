# Chessr Cron Service
# Runs periodic tasks like plan expiration checks and rating updates

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

# Create cron jobs
# Check plan expirations every 10 minutes
# Update ratings every 30 minutes
# Note: signup notifications are handled by the Discord bot
RUN echo "*/10 * * * * cd /app && pnpm check-expirations >> /proc/1/fd/1 2>&1" > /etc/crontabs/root && \
    echo "*/30 * * * * cd /app && pnpm update-ratings >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root

# Create startup script that logs and runs crond
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'echo "[CRON] Starting cron service..."' >> /start.sh && \
    echo 'echo "[CRON] Running check-expirations on startup..."' >> /start.sh && \
    echo 'cd /app && pnpm check-expirations 2>&1 || true' >> /start.sh && \
    echo 'echo "[CRON] Running update-ratings on startup..."' >> /start.sh && \
    echo 'cd /app && pnpm update-ratings 2>&1 || true' >> /start.sh && \
    echo 'echo "[CRON] Cron daemon started"' >> /start.sh && \
    echo 'exec crond -f -l 2' >> /start.sh && \
    chmod +x /start.sh

CMD ["/start.sh"]
