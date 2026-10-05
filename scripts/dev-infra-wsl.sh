#!/usr/bin/env bash
set -euo pipefail
# Optional local fallback when Docker Desktop is unavailable. Run as root inside Ubuntu WSL.
# Uses dedicated cluster, database names and ports; never touches Windows PostgreSQL.
orbita_postgres_port=${ORBITA_POSTGRES_PORT:-54432}
if ! [[ "$orbita_postgres_port" =~ ^[0-9]{4,5}$ ]] || (( orbita_postgres_port < 1024 || orbita_postgres_port > 65535 )); then
  printf 'ORBITA_POSTGRES_PORT must be a port between 1024 and 65535.\n' >&2
  exit 1
fi
version=$(ls /usr/lib/postgresql | sort -V | tail -1)
if ! pg_lsclusters -h | awk '{print $2}' | grep -qx orbita; then
  pg_createcluster "$version" orbita --port="$orbita_postgres_port" --start -- --auth-host=scram-sha-256 --auth-local=peer
else
  if test "$(pg_lsclusters -h | awk '$2=="orbita" {print $3}')" != "$orbita_postgres_port"; then
    pg_ctlcluster "$version" orbita stop || test "$(pg_lsclusters -h | awk '$2=="orbita" {print $4}')" = down
    pg_conftool "$version" orbita set port "$orbita_postgres_port"
  fi
  pg_ctlcluster "$version" orbita start || test "$(pg_lsclusters -h | awk '$2=="orbita" {print $4}')" = online
fi
runuser -u postgres -- psql -p "$orbita_postgres_port" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE orbita LOGIN PASSWORD ''orbita_local_only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='orbita') \gexec
SELECT 'CREATE DATABASE orbita OWNER orbita'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='orbita') \gexec
SELECT 'CREATE DATABASE orbita_test OWNER orbita'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='orbita_test') \gexec
SQL
for database in orbita orbita_test; do
  runuser -u postgres -- psql -p "$orbita_postgres_port" -d "$database" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS postgis'
done
mkdir -p /var/lib/orbita-redis
if ! redis-cli -p 56379 ping >/dev/null 2>&1; then
  redis_binary=/opt/orbita/redis-7.4.11/src/redis-server
  test -x "$redis_binary" || redis_binary=redis-server
  "$redis_binary" --port 56379 --bind 127.0.0.1 --daemonize yes --appendonly yes --dir /var/lib/orbita-redis --pidfile /var/lib/orbita-redis/redis.pid --logfile /var/lib/orbita-redis/redis.log
fi
for attempt in {1..30}; do
  if test "$(redis-cli -p 56379 --raw ping 2>/dev/null)" = PONG; then
    printf 'PostgreSQL/PostGIS and Redis are ready.\n'
    exit 0
  fi
  sleep 1
done
printf 'Redis did not become ready within 30 seconds.\n' >&2
exit 1
