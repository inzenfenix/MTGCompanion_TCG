#!/usr/bin/env bash
# Thin wrapper so you don't have to remember the -f/--env-file flags.
#
#   backend/docker/dev.sh up      # start postgres + minio + mailhog
#   backend/docker/dev.sh down    # stop them (add --volumes to wipe data)
#   backend/docker/dev.sh logs    # tail logs
#   backend/docker/dev.sh ps      # show status
#
# Equivalent to (from backend/): npm run docker:up / npm run docker:down

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

if [ ! -f .env ]; then
  echo "backend/.env not found — copy .env.example to .env first (cp .env.example .env)." >&2
  exit 1
fi

COMPOSE=(docker compose -f docker/docker-compose.yml --env-file .env)

case "${1:-}" in
  up)
    "${COMPOSE[@]}" up -d
    ;;
  down)
    shift || true
    "${COMPOSE[@]}" down "$@"
    ;;
  logs)
    "${COMPOSE[@]}" logs -f
    ;;
  ps)
    "${COMPOSE[@]}" ps
    ;;
  *)
    echo "Usage: $0 {up|down|logs|ps}" >&2
    exit 1
    ;;
esac
