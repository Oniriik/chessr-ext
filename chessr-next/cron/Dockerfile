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

# Create cron job: run every hour at minute 0
# Format: minute hour day month weekday command
RUN echo "0 * * * * cd /app && pnpm check-expirations >> /var/log/cron.log 2>&1" > /etc/crontabs/root

# Create log file
RUN touch /var/log/cron.log

# Run crond in foreground with logging
CMD crond -f -l 2
