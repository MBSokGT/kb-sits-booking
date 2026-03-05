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

DB_FILE_RAW="${DB_FILE:-./data/kb-sits.sqlite}"
if [[ "$DB_FILE_RAW" = /* ]]; then
  DB_FILE="$DB_FILE_RAW"
else
  DB_FILE="$PROJECT_ROOT/$DB_FILE_RAW"
fi

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-730}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_FILE="$BACKUP_DIR/kb-sits-$TIMESTAMP.sqlite"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_FILE" ]]; then
  echo "[backup] DB file not found: $DB_FILE" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".timeout 5000" ".backup '$TMP_FILE'"
else
  cp -f "$DB_FILE" "$TMP_FILE"
fi

gzip -f "$TMP_FILE"

find "$BACKUP_DIR" -type f -name 'kb-sits-*.sqlite.gz' -mtime "+$RETENTION_DAYS" -delete

echo "[backup] saved: $TMP_FILE.gz"
