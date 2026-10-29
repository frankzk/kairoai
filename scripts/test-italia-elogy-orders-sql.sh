#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
name=codex-italia-orders-qa-$(date -u +%Y%m%d%H%M%S)
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
[ "$(awk '/MemAvailable/{print $2}' /proc/meminfo)" -gt 800000 ] || { echo 'Insufficient memory'; exit 1; }
docker run -d --pull never --name "$name" --label codex.task=italia-orders-elogy --network none --memory=256m --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine -c shared_buffers=16MB -c max_connections=20 >/dev/null
for i in $(seq 1 25); do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
cat tests/fixtures/italia-elogy-orders-base.sql supabase/migrations/20261029171044_italia_pedidos_conciliados_elogy.sql supabase/migrations/20261029171910_italia_conciliacion_contadores.sql tests/italia-elogy-orders-database.sql | docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q
