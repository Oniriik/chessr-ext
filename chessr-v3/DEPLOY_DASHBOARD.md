# Deploy the dashboard at beta.dashboard.chessr.io

## 1. DNS

Add an A record on chessr.io:
```
beta.dashboard.chessr.io → 135.125.201.246
```

## 2. Upload / create `chessr-v3/.env` on the server

`docker-compose.beta.yml` now uses `${VAR}` interpolation that reads from
`chessr-v3/.env` (gitignored). Copy `.env.example` and fill it:

```bash
scp chessr-v3/.env.example chessr-beta:/opt/chessr/chessr-v3/.env
ssh chessr-beta
cd /opt/chessr/chessr-v3
vim .env   # paste the real values
```

## 3. Acquire the TLS cert for the dashboard subdomain

`beta.dashboard.chessr.io.conf` references a cert that doesn't exist yet, so
temporarily disable it and use the http-only helper:

```bash
cd /opt/chessr/chessr-v3
# keep only the http-only config until we have a cert
mv nginx/conf.d/beta.dashboard.chessr.io.conf nginx/conf.d/beta.dashboard.chessr.io.conf.disabled

# reload nginx (picks up the http-only block)
sudo docker compose -f docker-compose.beta.yml exec nginx nginx -s reload

# request the cert (entrypoint override, as for beta.chessr.io earlier)
sudo docker compose -f docker-compose.beta.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  --email oniriik.dev@gmail.com --agree-tos --no-eff-email \
  -d beta.dashboard.chessr.io --non-interactive

# swap back to the TLS config + reload
mv nginx/conf.d/beta.dashboard.chessr.io.http-only.conf nginx/conf.d/beta.dashboard.chessr.io.http-only.conf.disabled
mv nginx/conf.d/beta.dashboard.chessr.io.conf.disabled nginx/conf.d/beta.dashboard.chessr.io.conf
sudo docker compose -f docker-compose.beta.yml exec nginx nginx -s reload
```

## 4. Build + start the dashboard container

```bash
sudo docker compose -f docker-compose.beta.yml up -d --build dashboard
```

## 5. Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://beta.dashboard.chessr.io/login
# → 200
```

Then browse to https://beta.dashboard.chessr.io → login with an admin account.
