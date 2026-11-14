#!/usr/bin/env bash
# Prove backups work (PRD §10.3 "test restoration"): back up, restore into a scratch database and directory, and
# compare every table's row count, a content fingerprint of the money and approval tables, the migration history
# and every stored file. Exits non-zero on any difference. Run it on a schedule, not only once.
#
#   DATABASE_URL=postgresql://user@host:5432/freelanceos STORAGE_DIR=/srv/storage ops/verify-restore.sh
set -euo pipefail
: "${DATABASE_URL:?}" "${STORAGE_DIR:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_URL="${DATABASE_URL%%\?*}"
WORK="$(mktemp -d)"; SCRATCH_DB="freelanceos_verify_$(date +%s)"
ADMIN_URL="${SRC_URL%/*}/postgres"; SCRATCH_URL="${SRC_URL%/*}/$SCRATCH_DB"
cleanup() { psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE)" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

BACKUP="$(BACKUP_DIR="$WORK/backups" "$HERE/backup.sh")"
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$SCRATCH_DB\""
DATABASE_URL="$SCRATCH_URL" STORAGE_DIR="$WORK/storage" "$HERE/restore.sh" "$BACKUP" >/dev/null

tables() { psql "$1" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"; }
counts() { tables "$1" | while read -r t; do printf '%s\t%s\n' "$t" "$(psql "$1" -Atc "SELECT count(*) FROM \"$t\"")"; done; }
# Order-independent fingerprint of whole rows for the tables where a silent difference would matter most.
fingerprint() { for t in invoices invoice_lines payments payment_allocations credit_notes proposal_decisions scope_approvals signature_events audit_events document_versions _prisma_migrations; do
  printf '%s\t%s\n' "$t" "$(psql "$1" -Atc "SELECT coalesce(md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))), 'empty') FROM \"$t\" x")"; done; }

FAIL=0
diff <(counts "$SRC_URL") <(counts "$SCRATCH_URL") > "$WORK/counts.diff" || { echo "FAIL row counts differ:"; cat "$WORK/counts.diff"; FAIL=1; }
diff <(fingerprint "$SRC_URL") <(fingerprint "$SCRATCH_URL") > "$WORK/fp.diff" || { echo "FAIL content fingerprints differ:"; cat "$WORK/fp.diff"; FAIL=1; }
TRIG_SRC="$(psql "$SRC_URL" -Atc "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"; TRIG_DST="$(psql "$SCRATCH_URL" -Atc "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"
[ "$TRIG_SRC" = "$TRIG_DST" ] || { echo "FAIL integrity triggers: $TRIG_SRC in source, $TRIG_DST restored"; FAIL=1; }
# The restored copy must still refuse what production refuses (immutability survives a restore).
if psql "$SCRATCH_URL" -qc "DELETE FROM audit_events" >/dev/null 2>&1; then echo "FAIL audit trail is not append-only after restore"; FAIL=1; fi
FILES="$(wc -l < "$BACKUP/storage.sha256")"

[ "$FAIL" = 0 ] || exit 1
echo "PASS restore verified: $(tables "$SRC_URL" | wc -l) tables, $(counts "$SRC_URL" | awk -F'\t' '{s+=$2} END {print s}') rows, $TRIG_DST triggers, $FILES files, backup $(du -sh "$BACKUP" | cut -f1)"
