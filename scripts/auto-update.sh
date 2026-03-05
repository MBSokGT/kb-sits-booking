#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/opt/kb-sits-booking}"
ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

BRANCH="${AUTO_UPDATE_BRANCH:-main}"
REMOTE="${AUTO_UPDATE_GIT_REMOTE:-origin}"
MODE="${AUTO_UPDATE_MODE:-node}"            # node | docker
HEALTH_URL="${AUTO_UPDATE_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TIMEOUT_SEC="${AUTO_UPDATE_HEALTH_TIMEOUT:-120}"
SERVICE_NAME="${AUTO_UPDATE_SERVICE_NAME:-kb-sits}"

cd "$PROJECT_ROOT"

if [[ ! -d .git ]]; then
  echo "[auto-update] git repo not found in $PROJECT_ROOT" >&2
  exit 1
fi

# Never auto-update with local uncommitted changes.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[auto-update] working tree is dirty, skip update" >&2
  exit 1
fi

echo "[auto-update] checking $REMOTE/$BRANCH ..."
git fetch --prune "$REMOTE" "$BRANCH"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  echo "[auto-update] already up to date ($LOCAL_SHA)"
  exit 0
fi

echo "[auto-update] updating $LOCAL_SHA -> $REMOTE_SHA"
git pull --ff-only "$REMOTE" "$BRANCH"

case "$MODE" in
  node)
    npm ci
    systemctl restart "$SERVICE_NAME"
    ;;
  docker)
    docker compose up -d --build
    ;;
  *)
    echo "[auto-update] unknown AUTO_UPDATE_MODE=$MODE (expected node|docker)" >&2
    exit 1
    ;;
esac

# Health check loop
ATTEMPTS=$(( HEALTH_TIMEOUT_SEC / 3 ))
if (( ATTEMPTS < 1 )); then ATTEMPTS=1; fi

for _ in $(seq 1 "$ATTEMPTS"); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[auto-update] health check ok"
    exit 0
  fi
  sleep 3
done

echo "[auto-update] health check failed: $HEALTH_URL" >&2
exit 1
