#!/usr/bin/env bash
set -euo pipefail

# Full deployment backup. The application-level .rbk export remains the
# portable encrypted data backup; this script additionally captures PostgreSQL
# schema/data, PostgreSQL roles, and optional external storage.
#
# Required:
#   DATABASE_URL=postgresql://.../recordkeeper
# Optional:
#   BACKUP_DIR=/opt/recordkeeper/backups
#   EXTERNAL_STORAGE_DIR=/opt/recordkeeper/uploads

umask 077

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' "DATABASE_URL is required (use .pgpass rather than embedding a password in this script)." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/opt/recordkeeper/backups}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="$BACKUP_DIR/recordkeeper-$STAMP"
ARCHIVE="$BACKUP_DIR/recordkeeper-disaster-$STAMP.tar.gz"
EXTERNAL_STORAGE_DIR="${EXTERNAL_STORAGE_DIR:-}"

mkdir -p "$RUN_DIR"
trap 'rm -rf "$RUN_DIR"' EXIT

printf '%s\n' "Creating PostgreSQL schema/data dump..."
pg_dump --format=custom --no-owner --file "$RUN_DIR/database.dump" "$DATABASE_URL"

printf '%s\n' "Creating PostgreSQL roles/globals dump..."
pg_dumpall --globals-only > "$RUN_DIR/postgresql-globals.sql"

cat > "$RUN_DIR/manifest.txt" <<EOF
Created (UTC): $STAMP
Database dump: database.dump
PostgreSQL globals: postgresql-globals.sql
External storage: ${EXTERNAL_STORAGE_DIR:-not configured}
Restore order: PostgreSQL globals, database.dump, external storage
EOF

if [[ -n "$EXTERNAL_STORAGE_DIR" ]]; then
  if [[ ! -d "$EXTERNAL_STORAGE_DIR" ]]; then
    printf '%s\n' "External storage directory does not exist: $EXTERNAL_STORAGE_DIR" >&2
    exit 1
  fi
  printf '%s\n' "Creating external-storage archive..."
  tar --acls --xattrs --numeric-owner -czf "$RUN_DIR/external-storage.tar.gz" \
    -C "$(dirname "$EXTERNAL_STORAGE_DIR")" "$(basename "$EXTERNAL_STORAGE_DIR")"
fi

printf '%s\n' "Creating checksums..."
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$RUN_DIR" && sha256sum * > SHA256SUMS)
else
  (cd "$RUN_DIR" && shasum -a 256 * > SHA256SUMS)
fi

printf '%s\n' "Packaging disaster-recovery backup..."
tar --acls --xattrs --numeric-owner -czf "$ARCHIVE" -C "$BACKUP_DIR" "recordkeeper-$STAMP"

printf '%s\n' "Backup created: $ARCHIVE"
printf '%s\n' "Protect this archive: it contains database data and PostgreSQL role definitions."
