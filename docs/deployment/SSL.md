# SSL & Domain Configuration

Guide to setting up HTTPS with Let's Encrypt certificates.

## Domain Configuration

### Required DNS Records

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | ws | 135.125.201.246 | 300 |
| A | admin | 135.125.201.246 | 300 |

### Verify DNS Propagation

```bash
# Check DNS resolution
dig +short ws.chessr.io
dig +short admin.chessr.io

# Both should return: 135.125.201.246
```

## SSL Certificate Setup

### Initial Setup

```bash
# 1. Stop all containers
docker compose --profile with-nginx down

# 2. Install certbot
sudo apt update
sudo apt install -y certbot

# 3. Obtain certificates (standalone mode)
sudo certbot certonly --standalone \
  -d ws.chessr.io \
  -d admin.chessr.io \
  --email oniriik.dev@gmail.com \
  --agree-tos

# 4. Start containers
docker compose --profile with-nginx up -d
```

### Certificate Locations

| Domain | Certificate | Key |
|--------|-------------|-----|
| ws.chessr.io | `/etc/letsencrypt/live/ws.chessr.io/fullchain.pem` | `privkey.pem` |
| admin.chessr.io | `/etc/letsencrypt/live/admin.chessr.io/fullchain.pem` | `privkey.pem` |

## Certificate Renewal

### Automatic Renewal

Let's Encrypt certificates expire after 90 days. Setup auto-renewal:

```bash
# Add cron job
sudo crontab -e

# Add this line (runs twice daily)
0 0,12 * * * certbot renew --quiet --post-hook 'docker restart chess-nginx'
```

### Manual Renewal

```bash
# Stop nginx to free port 80
docker stop chess-nginx

# Renew certificates
sudo certbot renew

# Restart nginx
docker start chess-nginx
```

### Check Certificate Expiry

```bash
# Check expiration dates
sudo certbot certificates
```

## Nginx Configuration

### SSL Settings in nginx.conf

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name ws.chessr.io;

    ssl_certificate /etc/nginx/ssl/live/ws.chessr.io/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/live/ws.chessr.io/privkey.pem;

    # TLS configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS header
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

### HTTP to HTTPS Redirect

```nginx
server {
    listen 80;
    server_name ws.chessr.io;

    # ACME challenge for certificate renewal
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all other requests to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}
```

## Testing SSL

### Browser Test

Visit `https://ws.chessr.io` - should show WebSocket info page.

### Command Line Test

```bash
# Test SSL connection
openssl s_client -connect ws.chessr.io:443 -servername ws.chessr.io

# Test WebSocket
wscat -c wss://ws.chessr.io
```

### SSL Labs Test

Check your SSL configuration at [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=ws.chessr.io)

## Troubleshooting

### Certificate not found

```bash
# Check certificate exists
sudo ls -la /etc/letsencrypt/live/

# Check nginx has access
docker exec chess-nginx ls -la /etc/nginx/ssl/live/
```

### Nginx SSL error

```bash
# Test nginx config
docker exec chess-nginx nginx -t

# Check nginx logs
docker logs chess-nginx
```

### Port 80/443 already in use

```bash
# Find process using port
sudo netstat -tlnp | grep ':80'
sudo netstat -tlnp | grep ':443'

# Stop conflicting service
sudo systemctl stop nginx  # system nginx
sudo systemctl stop apache2
```

### ACME challenge failed

```bash
# Ensure port 80 is accessible
sudo ufw allow 80/tcp

# Test with curl
curl http://ws.chessr.io/.well-known/acme-challenge/test
```
