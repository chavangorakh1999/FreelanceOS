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
| 3 Delivery & scope | projects, scope versions/freeze, milestones, tasks, change requests | |
| 4 Finance | invoices, payments + allocations, credit notes — *calculation core already in `packages/shared`* | |
| 5 Portal & comms | client portal, comments, email | |
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

## Open product decisions
Carried over from PRD §20 — notably e-signature provider, email provider, GST/TDS invoice rules and invoice
numbering scope (financial-year numbering is the current default, configurable in `workspace_settings`).
