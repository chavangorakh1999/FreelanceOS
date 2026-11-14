# Performance: method, results, fixes

PRD §10.2 target: common authenticated operations within **500 ms at p95**, responsive search and filtering with thousands of
records, bounded queries, no N+1.

## Method

- `ops/perf/seed-large.mjs [scale]` builds a workspace through the public API, so every record passes the same validation
  as real use. Scale 1: 300 clients, 600 engagements, 400 proposals, 150 projects with 600 milestones and 3,000 tasks,
  1,500 invoices, 800 payments with allocations, 300 documents. Scale 5 is five times that (about 125,000 rows in all).
- `ops/perf/bench.mjs` signs in and calls 23 common endpoints 120 times each, 8 at a time, after one warm-up call, and
  reports p50, p95 and the slowest request.
- Environment: one API process and PostgreSQL 16 on the same 4-vCPU container, no cache in front. Production on separate
  hosts should do at least as well.

## Results (p95, milliseconds)

| Endpoint | Scale 1 | Scale 5, before | Scale 5, after |
|---|---:|---:|---:|
| Dashboard | 238 | **814** | 298 |
| Finance overview | 186 | **851** | 249 |
| Invoices, open | 154 | **563** | 154 |
| Invoices, overdue | 114 | 356 | 25 |
| Payments | 207 | **826** | 32 |
| Calendar, one month | 316 | **1,260** | 309 |
| Clients (page, search) | 54, 42 | 43, 67 | 38, 47 |
| Projects, project detail, tasks | 45, 27, 21 | 43, 27, 30 | 42, 26, 23 |
| Proposals, agreements | 36, 22 | 44, 22 | 37, 18 |
| Documents (list, search) | 111, 40 | 82, 70 | 82, 61 |
| Global search | 73 | 93 | 85 |
| Activity, notifications | 30, 15 | 25, 17 | 27, 13 |

No errors in any run. Every endpoint is under target at scale 5.

## What was fixed

1. **Finance totals in the database.** The overview loaded every issued invoice and every payment into the process and added
   them up, so its cost grew with the business. It is now one aggregate query per currency, with exactly the same definitions
   (outstanding = total − cash − withholding − credit; ageing buckets by days past due). The finance tests are unchanged and pass.
2. **Balance views paged in SQL.** *Open, overdue, paid* invoices and *unallocated* payments were decided in memory and then paged;
   they are now filtered, ordered and paged in the database. User search text is escaped so `%` and `_` are literal.
3. **Bounded calendar.** Each event type is fetched with a limit and counted separately; past 1,000 events the response says
   `truncated` and the page asks for a project or type filter. The `.ics` export covers up to 10,000 events per type within its
   one-year range.
4. **Compression.** JSON over 2 KB is gzip-compressed. Measured: a busy calendar month went from 593 KB (uncapped,
   uncompressed) to 233 KB capped, and 52 KB over the wire.
5. **Indexes** for the new date-range access paths: tasks and milestones by due date, agreements by expiry, proposal
   versions by status and validity, payments by received date, each led by `workspaceId`.

## A note on cold statistics

Straight after a bulk load, before PostgreSQL's autovacuum has analysed the new tables, the first dashboard requests were
slow (p95 3.6 s at scale 1). Once statistics existed the same requests took 0.2 s. After a large import or a restore, run
`ANALYZE` (the operations runbook says so).

## Re-running

```bash
API=http://localhost:4000 node ops/perf/seed-large.mjs 5
API=http://localhost:4000 node ops/perf/bench.mjs <projectId> <clientId>
```

The seed prints the two ids. Run against a throwaway database: seeding requires rate limits to be off (`NODE_ENV=test`,
`THROTTLE_DISABLED=true`), which the API honours only in test mode.
