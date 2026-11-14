#!/usr/bin/env bash
# Restore a backup made by ops/backup.sh into an EMPTY database and storage directory. Refuses to touch a database
# that already has tables, so it can never overwrite production by accident.
#
#   DATABASE_URL=postgresql://.../freelanceos_restored STORAGE_DIR=/srv/restore/storage ops/restore.sh /srv/backups/freelanceos-<stamp>
set -euo pipefail
SRC="${1:?usage: restore.sh <backup directory>}"
: "${DATABASE_URL:?set DATABASE_URL to the target (empty) database}" "${STORAGE_DIR:?set STORAGE_DIR to the target directory}"
DB_URL="${DATABASE_URL%%\?*}"

(cd "$SRC" && sha256sum --quiet -c MANIFEST.sha256) || { echo "backup is damaged: checksum mismatch" >&2; exit 2; }
EXISTING="$(psql "$DB_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
[ "$EXISTING" = "0" ] || { echo "target database is not empty ($EXISTING tables); refusing to restore over it" >&2; exit 3; }

pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DB_URL" "$SRC/db.dump"
psql "$DB_URL" -qc "ANALYZE" # fresh statistics, or the first queries plan badly (docs/performance.md)
mkdir -p "$STORAGE_DIR"; chmod 700 "$STORAGE_DIR"
tar -C "$STORAGE_DIR" -xzf "$SRC/storage.tar.gz"
(cd "$STORAGE_DIR" && sha256sum --quiet -c "$SRC/storage.sha256") || { echo "restored files do not match the backup" >&2; exit 4; }
echo "restored $SRC"
