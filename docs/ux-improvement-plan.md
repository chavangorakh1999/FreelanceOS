# UX, navigation and flow: audit and plan

Audit of the freelancer workspace and client portal against the PRD, done on a seeded workspace (3 clients, 4 engagements,
3 proposals, a signed agreement, an active project with scope, milestones, tasks and a change request, 4 invoices, a split payment).
Every screen was captured at 1440 px and reviewed.

## What the PRD asks for (the yardstick)

| PRD | Requirement | Where the app stands |
|---|---|---|
| §2.1 #1 One source of truth | records connected, not re-entered | records are linked in the data, but screens rarely show the links: a client page shows only engagements; a proposal does not show the agreement or project made from it |
| §6.1 Workspace navigation | 12 destinations, in that order | matches (Calendar, Documents marked *Soon*) |
| §7.2 Dashboard (P0) | pending approvals and attention items; upcoming deadlines and milestone dates; quick actions for client, engagement, proposal, project, invoice | **missing**: no attention list, no deadlines, one quick action (New client) |
| §8.1 Lead to project | client → engagement → proposal → agreement → project → scope | each step exists; the *next step* is not always offered, and is sometimes offered when it is already done |
| §10.4 Usability | keyboard, focus, status not by colour alone, useful states | focus and states are in place; status colours mislead (see V1) |
| §10.5 Responsive | intentional narrow-screen table strategy | tables scroll sideways inside their card (acceptable); rows are not tappable |
| §11.2 Layout | compact top header with breadcrumbs, global actions, account; one primary action per page; detail drawers; search near data | no top header; breadcrumbs show only the parent; global search (P1) absent |

## Findings

### Navigation and information architecture
- **N1. Only the name is clickable in lists.** Clients, proposals, agreements, projects, change requests, invoices, payments, a client's engagements, a project's change requests, the engagement board: the whole row or card should open the record.
- **N2. No top header.** Breadcrumbs are a small parent link above the title; the current page and the full path are missing, and there is nowhere for global actions.
- **N3. One quick action.** The sidebar offers only *New client*; the PRD asks for client, engagement, proposal, project and invoice.
- **N4. The client page is not a hub.** It lists engagements only. Proposals, agreements, projects, invoices and payments for that client are a filter away on other pages.
- **N5. Lifecycle links are one-way.** A proposal does not show the agreement or project created from it (and still offers *Start project* after one exists); an engagement does not list its proposals and projects.

### Visual semantics
- **V1. Positive states look like errors.** The *success* tone is coral, so *Active*, *Signed*, *Applied* and *Approved* read as warnings.
- **V2. Progress bars are coral**, the same alarm reading.
- **V3. Duplicate status.** A proposal shows *Accepted* in the header and again in the status row.
- **V4. The agreement reads as nine separate cards.** A contract is one document: one sheet, ruled clauses.
- **V5. Project overview repeats progress** as a tile and again as a full-width bar.

### Flow
- **F1. Next step is not the primary action.** On an accepted proposal *Start project* sits above *Create agreement*; PRD §8.1 puts the agreement first.
- **F2. The client page has no way to start a proposal or project** for that client.

## Plan

Principles: connect what the data already connects; one primary action per page, and it is the next lifecycle step;
lists open on any click (keyboard: the name stays a real link); status colour carries meaning, never alarm by default.

### Phase A (done)
1. **Clickable rows and cards** (N1): a shared `RowLink` table row and clickable board cards; inner controls keep working; the name remains a real `<a>` for keyboard and middle-click.
2. **Top header** (N2, N3, §11.2): breadcrumbs with the current page, a **Create** menu (client, engagement, proposal, project, invoice) and notifications; the sidebar's lone *New client* becomes that menu.
3. **Client hub** (N4, F2): tabs on the client page (Overview, Proposals and agreements, Projects, Invoices and payments) with *New proposal* and *New project* for that client.
4. **Lifecycle links** (N5, F1): the API returns linked records; proposals show their agreements and projects and offer only the next step that is not done; engagements list their proposals and projects.
5. **Dashboard to PRD §7.2** (P0): *Needs attention* (overdue invoices, proposals awaiting the client, change requests awaiting assessment, scope in review) and *Coming up* (milestones and invoices due in the next 14 days).
6. **Status semantics** (V1 to V5): a quiet green for positive states, ink for progress, no duplicate status, the agreement as one document, no repeated progress.

### Phase B (done)
- Global search with a ⌘K palette across clients, projects, proposals, agreements, invoices (§7.2 P1, new `/search` endpoint, workspace-scoped).
- Detail drawers for quick inspection from lists (§11.2).
- Collapsible sidebar (§11.1).
- Dashboard date filters (§7.2 P1).

### Out of scope here
Documents and Calendar (separate phases in the PRD roadmap).

## Status of Phase A
All of N1 to N5, V1 to V5, F1 and F2 are done, plus the §7.2 dashboard attention list. Checked by `apps/api/test/navigation.e2e.ts`
(links and attention list, including workspace isolation), the type check, 180 API and 12 web tests, the Hallmark floor, the end-to-end portal
run, and a browser check that clicking anywhere in a row opens the record on every list, board cards open, the Create menu works,
the client tabs load and breadcrumbs show the full path.

## Status of Phase B
- **Global search**: `GET /search?q=` (at least 2 characters), workspace-scoped from the session, a few hits per type across clients (by name,
  email or contact), engagements, proposals, agreements, projects, change requests and invoices (by number or client). In the app: the header
  search field or ⌘K / Ctrl+K anywhere; an ARIA combobox, arrow keys and Enter, with *Jump to* shortcuts when empty.
- **Quick look**: a side panel from the invoices and clients lists (an icon button in the row, so the row's own click still opens the page);
  Escape or the backdrop closes it; *Open invoice / Open client* goes to the full page.
- **Collapsible sidebar**: an icon rail with labels kept for screen readers and as tooltips; remembered per browser.
- **Dashboard period**: this financial year (default), this month, last 30 or 90 days, this calendar year; applies to invoiced and cash received;
  outstanding and overdue are always as of today.

Checked by API tests (search scope and isolation, period), and a browser run of every item above.

## Verification
Type check, API and web tests, the Hallmark floor (`sloplint --scope app`), and the end-to-end browser run, plus a fresh screenshot pass of every screen.
