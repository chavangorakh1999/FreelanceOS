#!/usr/bin/env bash
# Back up FreelanceOS: the database (pg_dump custom format) and the private document storage, with a manifest of
# row counts and SHA-256 checksums so a restore can be proven complete. Safe to run while the app is serving.
#
#   DATABASE_URL=postgresql://... STORAGE_DIR=/srv/freelanceos/storage BACKUP_DIR=/srv/backups ops/backup.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}" "${STORAGE_DIR:?set STORAGE_DIR}" "${BACKUP_DIR:?set BACKUP_DIR}"
DB_URL="${DATABASE_URL%%\?*}" # pg tools do not understand Prisma's ?schema= suffix
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/freelanceos-$STAMP"
mkdir -p "$OUT"; chmod 700 "$OUT"

# One consistent snapshot of the database.
pg_dump --format=custom --no-owner --no-privileges --file="$OUT/db.dump" "$DB_URL"

# Row counts per table, taken for the manifest (informational: the app may write during the dump).
psql "$DB_URL" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" |
  while read -r t; do printf '%s\t%s\n' "$t" "$(psql "$DB_URL" -Atc "SELECT count(*) FROM \"$t\"")"; done > "$OUT/rowcounts.tsv"

# Document files. Versions are immutable and never overwritten, so a copy taken after the dump contains every file
# the dump refers to.
if [ -d "$STORAGE_DIR" ]; then tar -C "$STORAGE_DIR" -czf "$OUT/storage.tar.gz" .; else tar -czf "$OUT/storage.tar.gz" --files-from /dev/null; fi
(cd "$STORAGE_DIR" 2>/dev/null && find . -type f ! -name '.probe-*' -print0 | sort -z | xargs -0 -r sha256sum) > "$OUT/storage.sha256" || true

(cd "$OUT" && sha256sum db.dump storage.tar.gz rowcounts.tsv storage.sha256 > MANIFEST.sha256)
echo "$OUT"
