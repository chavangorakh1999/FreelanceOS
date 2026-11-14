# Security: controls and evidence

Phase 6 security and permission audit. Each PRD requirement is listed with where it is enforced and the test that proves it.
Tests live in `apps/api/test/`; run them with `pnpm --filter @freelanceos/api test`.

## Automated audit (generated, not hand-picked)

`security-audit.e2e.ts` reads every route from Nest's own metadata (`route-inventory.ts`: 181 routes, 121 taking ids, at the time of
writing). A route added later is covered without anyone remembering to add a test.

| Check | Result |
|---|---|
| Every route outside a 12-route public list refuses a request with no session (401) | all pass |
| A forged token is refused on every GET route | all pass |
| A staff token opens no portal route; a portal token opens no staff route | all pass |
| A second workspace, given the first workspace's real ids, gets no success from any route (GET answers 404/400/422, never 200), and nothing in the first workspace changes (no audit event, no rows) | all pass |
| Defensive headers present (nosniff, frame denial, HSTS, no `X-Powered-By`); errors carry no stack, SQL or paths; CORS does not echo a foreign origin | all pass |

## PRD §10.1 Security and privacy

| Requirement | Control | Evidence |
|---|---|---|
| Authentication on every protected API | global `AuthGuard`; `@Public()` only on a fixed list; portal routes add `PortalGuard` | `security-audit.e2e.ts` |
| Workspace isolation | `workspaceId` taken from the verified session only; every query scoped; 404 (never 403) across workspaces; database triggers reject cross-workspace links, grants and memberships | `security-audit.e2e.ts`, every module's e2e "other workspace" test |
| Client, contact and project access | portal visibility in one module (`portal/visibility.ts`); per-project grants; viewer vs approver | `portal-data.e2e.ts`, `documents.e2e.ts` |
| Password hashing, token generation | bcrypt cost 12 with a dummy hash for unknown accounts (no timing oracle); 32-byte random refresh tokens stored as SHA-256; invitation tokens hashed at rest, single use | `auth.e2e.ts`, `portal-auth.e2e.ts` |
| Secrets outside source control | `.env` is ignored; `.env.example` holds placeholders; the API refuses to start with a JWT secret under 32 characters | `config/env.ts` |
| TLS | terminated at the proxy; HSTS sent by the API (helmet) and by the web app in production | headers test |
| Encryption at rest | delegated to the database volume and storage volume (provider disk encryption); see operations runbook | `docs/operations.md` |
| Private file access | random storage keys, never exposed; authenticated, logged downloads with `nosniff` and a sandbox CSP instead of signed URLs (nothing to leak or expire) | `documents.e2e.ts` |
| Rate limits | global 300/min per client; login 10/min, setup 5/min, refresh 30/min; portal login and accept limited separately | `auth.e2e.ts`, `portal-auth.e2e.ts` (429 asserted) |
| Injection | Prisma parameterises everything; the few raw queries use tagged templates; DTO whitelisting rejects unknown fields | code review; validation tests |
| XSS | React escapes output; emails are text plus escaped HTML; user files download as attachments, never rendered inline | `notifications.e2e.ts` (escaping) |
| CSRF | the API reads bearer tokens, not cookies; the only cookies (refresh) are `httpOnly`, `SameSite=Strict` and scoped to `/auth` or `/portal/auth` | `auth.e2e.ts` cookie assertions |
| SSRF | the server fetches no user-supplied URL; PDF rendering uses our own HTML only | design |
| IDOR | every lookup includes the workspace (and for the portal, the client and grants) in the `WHERE` clause | `security-audit.e2e.ts` sweep |
| Audit trail | append-only `audit_events` (trigger), written in the same transaction as the change; covers auth, portal access, sharing, documents, money | e2e tests per module |
| Export and retention | owner-only workspace and client exports; erasure of a contact's personal data; scheduled purge of expired sessions and old email bodies | `retention.e2e.ts`, `docs/operations.md` |

## PRD §16.4 Security tests

| Required test | Where |
|---|---|
| Cross-workspace access | `security-audit.e2e.ts` and each module's isolation test |
| Cross-client organisation access | `portal-data.e2e.ts` ("another organisation can read none of it"), `documents.e2e.ts` |
| IDOR and permission bypass | `security-audit.e2e.ts`; viewer-cannot-decide tests in `portal-data.e2e.ts` |
| Expired and revoked invitations | `portal-auth.e2e.ts` (expired, revoked, superseded, reused, concurrent accept) |
| File access | `documents.e2e.ts` (no session, other workspace, other client, unshared, archived, ungranted project) |
| Rate limits on authentication | `auth.e2e.ts`, `portal-auth.e2e.ts` |

## Dependencies

`pnpm audit --prod` reported one high advisory (`deepmerge-ts`, reached only through Prisma's command-line config loader). It is pinned to
the patched major with a pnpm override; Prisma validate, generate and migrate were re-run and pass. The audit also caught `compression` 1.8.1 (added in this phase,
denial of service), upgraded to 1.8.2. Current result: no known vulnerabilities. CI now fails on any high or critical advisory.

## Known gaps (accepted for launch, tracked)

- **Script CSP:** the web app sends frame, form, base and object restrictions; a full `script-src` policy needs per-request nonces for
  Next.js and is the next hardening step.
- **Roles:** one owner per workspace today. The role column exists; per-role permissions are needed before inviting staff collaborators.
- **Optimistic concurrency** (§13): drafts are edited by one owner; version checks are needed before multi-user editing.
- **Malware scanning:** the hook exists (`UploadScanner`); connect a scanner before accepting client uploads.
