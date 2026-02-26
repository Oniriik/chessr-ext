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

# Create cron jobs
# Check plan expirations every 10 minutes
# Check new signups every 2 minutes
RUN echo "*/10 * * * * cd /app && pnpm check-expirations >> /proc/1/fd/1 2>&1" > /etc/crontabs/root && \
    echo "*/2 * * * * cd /app && pnpm notify-signups >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root

# Create startup script that logs and runs crond
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'echo "[CRON] Starting cron service..."' >> /start.sh && \
    echo 'echo "[CRON] Schedule: every 10 minutes"' >> /start.sh && \
    echo 'echo "[CRON] Running check-expirations on startup..."' >> /start.sh && \
    echo 'cd /app && pnpm check-expirations 2>&1 || true' >> /start.sh && \
    echo 'echo "[CRON] Running notify-signups on startup..."' >> /start.sh && \
    echo 'cd /app && pnpm notify-signups 2>&1 || true' >> /start.sh && \
    echo 'echo "[CRON] Cron daemon started"' >> /start.sh && \
    echo 'exec crond -f -l 2' >> /start.sh && \
    chmod +x /start.sh

CMD ["/start.sh"]
