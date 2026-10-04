#!/usr/bin/env bash
set -euo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git openssl curl ca-certificates nginx
systemctl enable --now docker

if ! swapon --show=NAME --noheadings | grep -q /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

install -d -m 700 /opt/orbita/config
cd /opt/orbita/app
if [ ! -s /opt/orbita/config/backend.env ]; then
  db_password=$(openssl rand -hex 32)
  redis_password=$(openssl rand -hex 32)
  cat > /opt/orbita/config/postgres.env <<EOF
POSTGRES_USER=orbita
POSTGRES_DB=orbita
POSTGRES_PASSWORD=$db_password
EOF
  cat > /opt/orbita/config/redis.conf <<EOF
bind 0.0.0.0
protected-mode yes
requirepass $redis_password
appendonly yes
appendfsync everysec
maxmemory 48mb
maxmemory-policy noeviction
EOF
  cat > /opt/orbita/config/backend.env <<EOF
NODE_ENV=development
NODE_OPTIONS=--max-old-space-size=144
PORT=3000
DATABASE_URL=postgresql://orbita:$db_password@postgres:5432/orbita?schema=public&connection_limit=5
REDIS_URL=redis://:$redis_password@redis:6379/0
CORS_ORIGINS=https://orbita-frontend-phi.vercel.app
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
PIN_PEPPER=$(openssl rand -hex 32)
OUTBOX_ENCRYPTION_KEY=$(openssl rand -hex 32)
MAPS_PROVIDER=mock
WHATSAPP_ENABLED=false
REAL_PAYMENTS_ENABLED=false
DOCUMENT_STORAGE_DIR=/app/.data/documents
EOF
  unset db_password redis_password
fi

# Build sequentially before starting services to reduce peak memory.
docker build --target migration -t orbita-migrate:local .
docker build -t orbita-backend:local .
docker compose -f deploy/aws/compose.yaml up -d --wait postgres redis
docker compose -f deploy/aws/compose.yaml --profile migration run --rm migrate
docker compose -f deploy/aws/compose.yaml up -d --wait api worker

# Only liveness is public until a domain and HTTPS have been configured.
cat > /etc/nginx/sites-available/orbita <<'EOF'
server {
    listen 80 default_server;
    server_name _;
    location = /api/v1/health/live {
        proxy_pass http://127.0.0.1:3000;
    }
    location / { return 503; }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/orbita /etc/nginx/sites-enabled/orbita
nginx -t
systemctl enable nginx
systemctl restart nginx
curl --fail --retry 12 --retry-delay 5 --retry-all-errors http://127.0.0.1:3000/api/v1/health/ready
touch /opt/orbita/bootstrap-complete
