// Latency benchmark for common authenticated operations (PRD §10.2: p95 under 500 ms).
//   API=http://localhost:4000 node ops/perf/bench.mjs <projectId> <clientId> [requests=120] [concurrency=8]
const API = process.env.API ?? 'http://localhost:4000';
const [projectId, clientId, REQ = '120', CONC = '8'] = process.argv.slice(2);
const token = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'a very long password 1' }) })).json()).accessToken;
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ROUTES = [
  ['dashboard', '/dashboard'], ['finance overview', '/finance/overview'], ['clients page', '/clients?page=1'], ['clients search', '/clients?q=labs'],
  ['client detail', `/clients/${clientId}`], ['engagements', '/engagements?pageSize=100'], ['proposals', '/proposals?page=1'], ['agreements', '/agreements'],
  ['projects', '/projects?page=1'], ['project detail', `/projects/${projectId}`], ['project tasks', `/projects/${projectId}/tasks`], ['milestones', `/projects/${projectId}/milestones`],
  ['invoices all', '/invoices?page=1'], ['invoices open', '/invoices?view=open'], ['invoices overdue', '/invoices?view=overdue'], ['payments', '/payments?page=1'],
  ['changes', '/change-requests'], ['documents', '/documents'], ['documents search', '/documents?q=brand'], ['global search', '/search?q=portal'],
  ['calendar month', `/calendar?from=${d(-15)}&to=${d(20)}`], ['activity', '/activity'], ['notifications', '/notifications'],
];
const pct = (a, p) => a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
const rows = [];
for (const [name, url] of ROUTES) {
  const times = []; let i = 0, errors = 0;
  await fetch(API + url, { headers: { Authorization: 'Bearer ' + token } }); // warm-up
  await Promise.all(Array.from({ length: Number(CONC) }, async () => {
    while (i++ < Number(REQ)) {
      const t = performance.now();
      const r = await fetch(API + url, { headers: { Authorization: 'Bearer ' + token } }); await r.arrayBuffer();
      if (!r.ok) errors++;
      times.push(performance.now() - t);
    }
  }));
  times.sort((x, y) => x - y);
  rows.push({ name, p50: pct(times, 50), p95: pct(times, 95), max: times[times.length - 1], errors });
}
const f = (n) => n.toFixed(0).padStart(5);
console.log(`endpoint               p50 ms  p95 ms  max ms  errors   (${REQ} requests, ${CONC} concurrent)`);
for (const r of rows) console.log(`${r.name.padEnd(22)} ${f(r.p50)}   ${f(r.p95)}   ${f(r.max)}   ${r.errors}${r.p95 > 500 ? '   OVER TARGET' : ''}`);
console.log(JSON.stringify({ over: rows.filter((r) => r.p95 > 500).map((r) => r.name), errors: rows.reduce((s, r) => s + r.errors, 0) }));
