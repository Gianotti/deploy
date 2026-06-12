#!/bin/bash
# Fuerza rebuild completo de imágenes y reinicia los servicios.
# Usar cuando hay cambios de código (Portainer solo re-aplica el command:, no reconstruye imágenes).
#
# Uso: bash redeploy-prod.sh [--no-cache]

set -e
cd "$(dirname "$0")"

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
  NO_CACHE="--no-cache"
  echo "▶ Modo sin caché: rebuild completo desde cero"
fi

echo "▶ Pulling latest code from git..."
git pull

echo "▶ Building images... $NO_CACHE"
docker compose -f docker-compose.prod.yml build $NO_CACHE backend frontend

echo "▶ Restarting services..."
docker compose -f docker-compose.prod.yml up -d --force-recreate backend frontend

echo "▶ Logs (Ctrl+C para salir):"
docker compose -f docker-compose.prod.yml logs -f --tail=50 backend frontend
