#!/usr/bin/env bash
# End-to-end regression (PRD §16.3, §17 Phase 6): drives the built apps in a real browser.
#   1. portal-flow         owner invites a client; the client accepts, decides, signs, approves, comments, downloads; access is revoked
#   2. navigation          rows and cards open records, Create menu, client hub tabs, breadcrumbs
#   3. search-quicklook    ⌘K search, collapsible sidebar, quick-look panels, dashboard period
#   4. documents-calendar  upload, versions, sharing, client download on a phone, calendar views and .ics export
#
#   E2E_DATABASE_URL=postgresql://user@host:5432/freelanceos_e2e ops/e2e/run.sh        (after `pnpm build`)
# The database named in E2E_DATABASE_URL is dropped and recreated. Set CHROMIUM_PATH to use a specific browser binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$ROOT/ops/e2e"
DB="${E2E_DATABASE_URL:?set E2E_DATABASE_URL to a throwaway database}"; DB="${DB%%\?*}"
NAME="${DB##*/}"; ADMIN="${DB%/*}/postgres"
OUT="${E2E_OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
API_PID=""; WEB_PID=""
cleanup() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null; [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null; true; }
trap cleanup EXIT

wait_for() { for _ in $(seq 60); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; echo "timed out waiting for $1" >&2; return 1; }
fresh_db() {
  psql "$ADMIN" -qc "DROP DATABASE IF EXISTS \"$NAME\" WITH (FORCE)" -c "CREATE DATABASE \"$NAME\"" 2>&1 | grep -v NOTICE || true
  (cd "$ROOT/apps/api" && DATABASE_URL="$DB?schema=public" npx prisma migrate deploy >/dev/null)
  rm -rf "$OUT/storage"
}
start_api() {
  if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; fi
  if curl -sf -o /dev/null http://localhost:4000/health/live; then echo "port 4000 is still in use by another process" >&2; exit 1; fi
  (cd "$ROOT/apps/api" && DATABASE_URL="$DB?schema=public" JWT_ACCESS_SECRET="e2e-secret-e2e-secret-e2e-secret-12345" WEB_ORIGIN=http://localhost:3000 \
    STORAGE_DIR="$OUT/storage" EMAIL_WORKER=off LOG_REQUESTS=off PORT=4000 exec node dist/main.js >> "$OUT/api.log" 2>&1) & API_PID=$!
  wait_for http://localhost:4000/health/live
}

printf '%%PDF-1.4\n%% FreelanceOS test brief\n1 0 obj<<>>endobj\ntrailer<<>>\n%%%%EOF\n' > "$OUT/brief.pdf"
printf '%%PDF-1.4\n%% brief v2\n%%%%EOF\n' > "$OUT/brief-v2.pdf"
export E2E_DATABASE_URL="$DB"

(cd "$ROOT/apps/web" && PORT=3000 exec node node_modules/next/dist/bin/next start -p 3000 > "$OUT/web.log" 2>&1) & WEB_PID=$!
wait_for http://localhost:3000/portal/login

fresh_db; start_api
node "$HERE/first-run.cjs"

fresh_db; start_api
mkdir -p "$OUT/shots"; node "$HERE/portal-flow.cjs" "$OUT/shots"

fresh_db; start_api
node "$HERE/seed.cjs" > "$OUT/ids.json"
node "$HERE/navigation.cjs" "$OUT"
node "$HERE/search-quicklook.cjs" "$OUT"
node "$HERE/documents-calendar.cjs" "$OUT"
node "$HERE/estimator.cjs"
fresh_db; start_api
E2E_OUT="$OUT" node "$HERE/real-user.cjs"

fresh_db; start_api
E2E_OUT="$OUT" node "$HERE/time-payments.cjs"

echo "E2E PASSED (screenshots and logs in $OUT)"
