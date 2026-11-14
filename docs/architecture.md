# Architecture notes

A modular monolith (PRD §12): one NestJS API, one Next.js web app, one PostgreSQL database, a shared
TypeScript package. No microservices, Kafka or Kubernetes.

```
apps/api            NestJS + Prisma (REST, JWT access + rotating refresh cookie)
apps/web            Next.js App Router + Tailwind v4 (freelancer workspace; client portal comes in Phase 5)
packages/shared     Money, tax, payment allocation, invoice numbering — pure, fully unit-tested
docs/               PRD, design system, these notes
```

## Decisions already encoded in code

| Rule (PRD) | Where it is enforced |
|---|---|
| Money never uses floats (App. B #16) | `packages/shared/src/money.ts` — `bigint` minor units; API money travels as decimal *strings*; DTO rejects JSON numbers |
| Original currency kept (App. B #12) | `currency` stored beside every amount; no cross-currency totals (dashboard groups per currency) |
| Workspace isolation (§10.1) | every query filters `workspaceId` from the *verified session*, never from the request; cross-workspace access returns 404 (tested) |
| Revoking access is immediate (§7.1) | `AuthGuard` re-checks the session row on every request, not just the JWT signature |
| Refresh token safety | opaque 256-bit token, only its SHA-256 stored, `httpOnly; SameSite=Strict`, scoped to `/auth`, rotated on every use |
| Audit is append-only (§7.14) | DB trigger blocks UPDATE/DELETE/TRUNCATE on `audit_events`; audit row written in the *same transaction* as the change |
| Stage history is a record of fact | same trigger pattern on `engagement_stage_history` |
| Archive, never cascade-delete (App. B #15) | all FKs `ON DELETE RESTRICT`; clients/contacts/engagements use `archivedAt` |
| One primary contact per client (§7.3) | partial unique index, not just service logic |
| Concurrency-safe numbering (App. B #11) | `NumberSequenceService`: single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, run inside the caller's transaction (gap-free on rollback); tested with 60 parallel callers |
| Accepted proposal versions are immutable (App. B #4) | DB trigger freezes a version and its sections, lines and payment terms once shared; only the status may advance, along allowed transitions; accepted is terminal |
| Signed agreements are immutable (App. B #5) | DB triggers freeze clauses and the signer list once sent; after that only a signer's own outcome columns may change; signed is terminal; signature events and proposal decisions are append-only |
| Decision references an exact version (§7.5) | compare-and-set on the version's status inside one transaction + a unique decision per version; a superseded or already-decided version is refused |
| Acceptance ≠ signature ≠ scope approval (§2 #7) | separate tables and states; an agreement can only be created from an *accepted* proposal and records the accepted version id |
| Signature events idempotent (§7.6, App. B #18) | `Idempotency-Key` unique per version; the version row is locked (`FOR UPDATE`) so simultaneous signatures cannot both win |
| Honest about legal weight (§7.6) | manual signatures require an evidence note; templates are labelled a starting point; documents with unresolved `[template guidance]` cannot be shared or sent |
| Stable error codes (§13) | `{ error: { code, message, details? } }` for every failure |
| Rate limiting (§10.1) | global throttler; stricter on `/auth/setup`, `/auth/login` |

## Deliberately not built yet
Password reset by email, passwordless links and client invitations (need the email provider — open decision #3),
optimistic-concurrency version checks on edits, the client portal, and everything from Phase 2 onward.
See the README roadmap.
