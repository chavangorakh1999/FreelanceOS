# FreelanceOS

All-in-one business management for independent freelancers — from first client conversation to final
payment, with a traceable record of what was promised, approved, delivered and paid.

Product requirements: [`docs/product-requirements.md`](docs/product-requirements.md) ·
Design system: [`docs/design-system.md`](docs/design-system.md) ·
Architecture notes: [`docs/architecture.md`](docs/architecture.md)

## Stack
Next.js + Tailwind (web) · NestJS modular monolith (API) · PostgreSQL + Prisma · pnpm workspaces · TypeScript

## Getting started

Requires Node 22+, pnpm 10+, and PostgreSQL 16 (`docker compose up -d` provides one).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # set JWT_ACCESS_SECRET to a long random string
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @freelanceos/shared build      # the API consumes the compiled shared package
pnpm db:migrate                              # apply migrations, generate the Prisma client
```

Run the two apps in separate terminals:

```bash
pnpm dev:api    # http://localhost:4000
pnpm dev:web    # http://localhost:3000  → first visit shows workspace setup
```

## Checks

```bash
pnpm build && pnpm typecheck && pnpm test
```

API tests are integration tests against a real PostgreSQL (migrations included). Point them at a throwaway
database with `TEST_DATABASE_URL`; tests wipe it between cases.

## Status against the PRD roadmap

| Phase | Scope | State |
|---|---|---|
| 0 Foundation | monorepo, auth + workspace, migrations, audit foundation, design system + responsive shell, CI | **done** (password reset needs email — pending) |
| 1 Client & sales | dashboard, clients + contacts, engagements + pipeline, activity | **done** (search/filter, board + list, stage history, interactions) |
| 2 Commercial docs | proposals + immutable versions, decisions, agreements + signature trail, templates, PDF | **done** (see gaps below) |
| 3 Delivery & scope | projects, scope versions/freeze, milestones, tasks + dependencies, change requests | **done** (see below) |
| 4 Finance | invoices, payments + allocations, credit notes — *calculation core already in `packages/shared`* | **done** (see below) |
| 5 Portal & comms | client portal, comments, email notifications | **done** (see below) |
| 6 Hardening | security audit, performance, backup/restore | |

### Phase 2 — what is and isn't there
Built: proposals (7 pricing models, sections, line items with server-computed totals, payment terms, share → lock,
negotiation versions, decisions recorded against the exact version, duplicate-as-replacement, expiry), agreements
(from an accepted proposal, clauses + ordered signers, send → lock with a SHA-256 fingerprint, manual signature
evidence, idempotent events, decline/void/expiry), starter templates, and PDFs for both.

Not yet: client-side acceptance and e-signature through the portal/provider (Phase 5 — until then the owner *records*
what the client told them, with channel and evidence), email delivery of shared documents, agreement amendments, version
comparison, a template editor UI, and stored documents (PDFs are generated on demand, not yet filed in a document library).

PDF generation needs Chromium. Set `CHROMIUM_PATH`, or run `pnpm --filter @freelanceos/api exec playwright-core install chromium`.

### Phase 3 — what is and isn't there
Built: projects created by an explicit action from an engagement / accepted proposal / signed agreement (the first scope
draft is seeded from the accepted proposal); versioned scope with review → approval → freeze and a delta view; milestones
with deliverables; tasks with dependencies (cycle-checked, start-blocking) in list and board views; change requests with an
impact assessment, both parties' decisions, a new scope version on approval, and an addendum gate before changed work begins.

**Decisions made (change them in one place if you disagree):**
- *Progress* has one definition: **completed tasks ÷ non-cancelled tasks**. Milestones are checkpoints with their own status
  and are never added in, so work is not counted twice (`packages/shared/src/projects.ts`).
- *Changes after signing:* the assessment records whether the signed agreement needs an **addendum**. If so, the change
  request stays blocked until you attest it is complete. The signed agreement itself is never edited.
- Starting delivery (`PLANNING → ACTIVE`) requires an approved scope; completing a project requires no open change requests.

Not yet: comments on tasks and scope (Phase 5, with the portal), client-side approval of scope and change requests (you record
what the client told you, with channel and evidence), the calendar, generated scope/change-proposal documents, amendment
documents (the addendum is attested, not authored), milestone acceptance records, and task assignment to other people.

### Phase 4 — what is and isn't there
Built: invoices (server-priced drafts, number reserved at issue, frozen once issued, void-if-untouched, credit notes,
explicit share-with-client, PDF); payments recorded idempotently and *reversed, never edited or deleted*; allocations
(one payment across many invoices, many payments on one invoice, same client + currency only); tax withheld by the payer
(TDS) as part of an allocation; balances and statuses always derived from the records; finance overview with receivables
ageing, per currency.

**Decisions made:**
- *Numbering* (PRD open #7): the number is reserved **at issue**, in the same transaction, so a failed issue never burns
  one. Default is a financial-year series (`INV/26-27/0042`, restarting each April); `workspace_settings` can switch to one
  continuous series, and change the prefix and padding. Numbers must run **in date order** (an invoice can't be dated
  before the latest one already issued in its series), as chronological numbering is commonly expected for tax invoices.
- *TDS* (PRD open #6): modelled as **withholding on an allocation**. It settles part of the invoice but is not cash from
  the payment, so a client paying ₹1,08,000 + ₹10,000 TDS clears a ₹1,18,000 invoice and the payment shows no leftover.
- *Reporting definitions* (PRD open #10) are fixed in `finance.service.ts`: **cash received** = payments in the period not
  reversed (not invoice value); **invoiced** = issued, non-void invoices in the period; **outstanding** = total − cash −
  withholding − credit notes, right now; **overdue** = the part of outstanding past its due date. Currencies are never
  added together.
- A reversed payment stops counting immediately; its record, and the history on every invoice it touched, stays.

**Not tax advice / not yet compliant:** line-level GST rates are supported, but the CGST/SGST/IGST split, SAC/HSN codes,
place of supply, e-invoicing/IRN, and TDS certificates are **not** implemented. Have invoices reviewed by a tax professional
before treating them as compliant (PRD open #6). The PDF carries a note saying so.

Not yet: expenses, retainers and service periods, recurring invoices, cross-currency allocation (refused — it needs a stated
exchange rate), refund records beyond reversal, payment-gateway collection, emailing invoices and receipts, a settings screen
for numbering (the columns exist), and the client-side view of shared invoices (Phase 5).

### Phase 5 — what is and isn't there

- **Email**: an `EmailProvider` adapter (SMTP via `SMTP_URL`, or a log provider in dev/tests). Emails are queued in a database outbox
  (`notification_deliveries`) with claim/lease, backoff (1m → 12h), a dead state the owner can see and retry in Settings. Emails are thin —
  no amounts or document content — and link behind sign-in. Owners and clients can switch categories off (invitations are always sent).
- **Client portal** (`/portal`): a separate identity from staff (own users, sessions, JWT audience and refresh cookie). Invitation links are
  single-use, hashed at rest and expire after 7 days. Access is per person: `VIEWER` (read-only + comment) or `APPROVER`, plus per-project
  grants. Removing access ends the person's session on their next request.
- **What a client can see** is only what the owner deliberately shared: non-draft proposal versions, sent agreements, client-visible projects
  they are granted, client-visible tasks only (never internal notes), scope versions put to them, shared change requests (without private
  risk notes) and shared invoices. Everything else is a 404.
- **Client actions** are recorded as the client's own act (`decidedByPortalUserId`, channel `PORTAL`, audit actor `CLIENT_CONTACT`): accept /
  decline / request changes on a proposal, sign an agreement (typed name, time, IP, user agent; in signing order), approve scope, decide and
  raise change requests.
- **Comments** on proposals, projects and change requests, append-only, each `INTERNAL` or `CLIENT_VISIBLE`.
- **Owner UI**: notifications centre with unread badge, "Client portal" card per client, share/visibility controls, comments, settings.

Not yet: magic-link sign-in, secure-link sharing without an account, a document library/file storage, email-event webhooks (bounces),
e-signature provider integration (portal signatures are typed-name evidence, not a qualified e-signature), calendar.

## Open product decisions
Carried over from PRD §20 — notably e-signature provider, email provider, GST/TDS invoice rules and invoice
numbering scope (financial-year numbering is the current default, configurable in `workspace_settings`).
