# Operations runbook

For whoever runs FreelanceOS in production. PRD §10.3 (availability and reliability) and §17 Phase 6.

## Service targets (proposed; confirm before launch)

| Target | Value | Why it is achievable |
|---|---|---|
| Availability | 99.5% monthly (about 3.6 hours) | one API and one web process behind a proxy; restarts take seconds |
| Latency | p95 under 500 ms for common operations | measured at 5x a heavy workspace, see `docs/performance.md` |
| RPO (data you can lose) | 24 hours with daily backups; 5 minutes with WAL archiving | `ops/backup.sh` nightly; managed PostgreSQL point-in-time recovery if available |
| RTO (time to recover) | 2 hours | a 125,000-row database plus 1,500 files restored and verified in 10 seconds; most of the 2 hours is provisioning |

## Running it

- **Processes:** the API (`node apps/api/dist/main.js`) and the web app (`pnpm --filter @freelanceos/web start`), behind a TLS proxy.
  The API sets `trust proxy` so client IPs (rate limits, audit) come from `X-Forwarded-For`.
- **Database:** PostgreSQL 16. Apply migrations on deploy with `pnpm --filter @freelanceos/api exec prisma migrate deploy`; they are
  forward-only and include the integrity triggers.
- **Storage:** `STORAGE_DIR` must be a persistent, backed-up volume readable only by the API user. Never serve it from the web server.
- **Background work:** the email outbox, invoice reminders and the daily retention purge run inside the API process
  (`EMAIL_WORKER=on`). With more than one API instance, turn it on in exactly one, or all of them: claims use row locks, so
  doubles are harmless, just wasteful.

### Configuration

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | |
| `JWT_ACCESS_SECRET` | yes | at least 32 random characters; the API refuses to start otherwise. Rotating it signs everyone out. |
| `WEB_ORIGIN` | yes | the only origin allowed by CORS; used in email links |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | yes, 20 | |
| `EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM` | for real email | `log` only prints |
| `METRICS_TOKEN` | recommended | enables `/metrics` |
| `LOG_REQUESTS` | `on` | JSON access log to stdout |
| `NODE_ENV=production` | yes | `THROTTLE_DISABLED` is ignored unless `NODE_ENV=test` |

## Monitoring

| Signal | Where | Alert when |
|---|---|---|
| Process up | `GET /health/live` | not 200 for 1 minute: restart |
| Can serve | `GET /health/ready` (database answers, storage writable) | 503 for 2 minutes: page |
| Email backlog | `/health/ready` → `email.oldestPendingSeconds`, `email.dead`; `/metrics` `email_outbox_*` | pending older than 1 hour, or any dead email: check SMTP, then retry from Settings |
| Errors | access log lines with `"level":"error"`; `/metrics` `http_requests_total{status="5xx"}` | more than 1% of requests for 5 minutes |
| Latency | `/metrics` `http_request_duration_seconds` (route patterns only) | p95 over 500 ms for 10 minutes |
| Database | provider metrics, `app_database_up` | connections near the limit, disk over 80% |

Every response carries `X-Request-Id`. A 500 response includes `requestId` in its body: ask the user for it, then find the matching
log line. Log lines contain the route pattern, status and duration only: never URLs, query strings, bodies, tokens or user data.

## Backups

- **Nightly:** `DATABASE_URL=… STORAGE_DIR=… BACKUP_DIR=… ops/backup.sh`. It writes `db.dump`, `storage.tar.gz`, row counts, file checksums
  and a `MANIFEST.sha256`. Copy the directory off the host (another region), keep 30 daily and 12 monthly, and encrypt it at rest.
- **Weekly, automatically:** `ops/verify-restore.sh` backs up, restores into a scratch database, and compares the following. It exits non-zero on any difference.
  - every table's row count
  - a content fingerprint of the money, approval, signature, audit and document-version tables
  - the migration history
  - the integrity triggers
  - that the audit trail is still append-only
  - every stored file's checksum
- **Restore for real:** create an empty database, then `DATABASE_URL=<new> STORAGE_DIR=<new> ops/restore.sh <backup dir>`. It refuses a
  damaged backup and refuses to write over a database that has tables. It runs `ANALYZE` at the end. Point the API at the new
  database and storage, then check `/health/ready`.

## Incidents

| Situation | Do this |
|---|---|
| Emails not arriving | `/health/ready` email block; Settings → *Emails that didn't go out* shows each failure and its error. Fix SMTP, then *Try again*. The outbox retries on its own (1m, 5m, 30m, 2h, 12h) before giving up. |
| A staff device is lost | Settings → Active sessions → Revoke. Sessions are checked on every request, so it takes effect at once. |
| A client should lose access | Client page → Client portal → Remove access. Their next request is refused. |
| Suspected leaked JWT secret | Rotate `JWT_ACCESS_SECRET` and restart: every access token stops working at once. Refresh tokens are separate (random values, stored hashed), so a leaked secret does not expose them, but revoke all sessions anyway so everyone signs in again: `UPDATE user_sessions SET "revokedAt" = now() WHERE "revokedAt" IS NULL`, and the same for `portal_sessions`. |
| Disk full on storage | Uploads fail with a clear error; downloads continue. Grow the volume. Nothing is deleted automatically except by the retention purge below. |
| Database restored from backup | Restart the API (clears in-process metrics), check `/health/ready`, run `ops/verify-restore.sh` on the new primary when calm. |
| Slow pages after a big import | Run `ANALYZE` (stale statistics give bad plans; see `docs/performance.md`). |

## Data export, erasure and retention

- **Export:** the owner can download everything (`GET /exports/workspace`) or everything about one client (`GET /exports/clients/:id`) as
  JSON. Credentials, token hashes, sessions and storage locations are never included. Each export is audited.
- **Erasure:** `POST /clients/:id/contacts/:cid/erase` (owner, body `{"confirm":"ERASE"}`) replaces the contact's details, ends their
  portal access immediately and anonymises their portal account if it has no other organisation. Signed agreements, invoices, decisions
  and the audit trail are kept as legal and financial records; that is the policy to state to the person asking.
- **Retention (daily, automatic):**
  - Ended sessions are deleted after 30 days.
  - Used, revoked or expired invitations are deleted after 90 days.
  - Sent email copies are deleted after 90 days; failed ones stay visible.
  - Read notifications are deleted after 180 days.
  - Business records are never purged.

## Release checklist

1. `pnpm build && pnpm typecheck && pnpm test` and `ops/e2e/run.sh` green.
2. `pnpm audit --prod` shows no high or critical advisories.
3. Back up, then `prisma migrate deploy`.
4. Deploy API, then web. Check `/health/ready`, sign in, open the dashboard.
5. Watch error rate and p95 for 30 minutes.
