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
| Frozen scope can't be edited (App. B #6-7) | DB triggers freeze a scope version and its items once submitted; one live APPROVED version per project; the only way to a new draft from approved scope is an approved change request |
| Scope approval references an exact version (§7.7) | `scope_approvals` is append-only and unique per version; approval supersedes the previous baseline in the same transaction |
| Change approval ≠ contract amendment (App. B #8) | approving creates a *draft scope version*, never touches agreement tables; `addendumStatus` gates "changed work may begin" |
| Rejected change leaves baseline untouched (§7.9) | rejection writes only a decision row; tested that no scope version is created |
| Original scope preserved, delta shown (§7.9) | items keep a stable `itemKey` across versions; the delta is computed, never stored |
| One progress method (App. B #19) | `progressOf()` in the shared package; milestones excluded from the percentage |
| Issued invoices aren't silently overwritten (§7.10) | DB trigger freezes the invoice and its lines once issued; only void/visibility fields change; corrections are credit notes |
| Invoices and payments are separate (App. B #9) | separate tables; a payment never edits an invoice |
| Payments split / partial (App. B #10) | `payment_allocations`: many-to-many, append-only, with an optional withholding amount |
| Financial events are never deleted (App. B #15) | payments and credit notes are immutable; a payment is undone only by a one-way *reversal*; DB blocks DELETE and edits |
| Balances aren't stored (§7.3) | derived from allocations (excluding reversed payments) and credit notes on every read |
| Over-allocation is impossible (§9.14) | service pre-checks with the shared money lib **and** a DB trigger that re-checks under row locks, so even a direct insert or a race fails |
| Concurrency-safe numbering (App. B #11) | number reserved inside the issuing transaction (gap-free on failure) + date-order check |
| Payment idempotency (App. B #18) | `Idempotency-Key` unique per workspace; identical racing requests return one payment |
| Original currency preserved (App. B #12) | amounts stay in their own currency; allocation across currencies is refused; reports never mix currencies |
| Clients are a separate identity (§4.2) | `portal_users/memberships/sessions`; JWT signed with a derived secret + `aud: portal`; session and membership re-checked in the DB every request |
| Clients see only what is shared (§4.2) | one visibility module (`portal/visibility.ts`); everything else is a 404; presenters pick fields explicitly (no `internalNotes`, `riskNotes`) |
| A client's decision is theirs (§7.5–7.9) | decision rows carry `decidedByPortalUserId` XOR `recordedById` (CHECK); portal calls the same services as an actor |
| Notifications never lost (§7.13) | transactional outbox, lease + backoff, dead-letter visible to the owner, thin emails |
| Files are private (§7.11) | random storage keys behind an adapter; bytes only via authenticated, logged downloads with `nosniff` and a sandbox CSP |
| File types are what the bytes say (§7.11) | magic-byte sniffing; executables, archives and unknown types refused before anything is written |
| Document history is permanent (§7.11) | versions and access logs append-only by trigger; links scoped to the document's workspace and client by trigger |
| The calendar cannot drift (§7.14) | events are derived from milestones, tasks, proposals, invoices and agreements on every read; nothing is stored |
| Stable error codes (§13) | `{ error: { code, message, details? } }` for every failure |
| Rate limiting (§10.1) | global throttler; stricter on `/auth/setup`, `/auth/login` |

## Deliberately not built yet
Password reset by email, magic links, optimistic-concurrency version checks on edits, document preview, S3 storage adapter, malware scanning, e-signature provider.
See the README roadmap.
