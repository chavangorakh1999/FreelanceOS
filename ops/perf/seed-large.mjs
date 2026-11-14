// Seeds a heavy, realistic freelancer workspace through the public API (no shortcuts past validation), for
// performance testing (PRD §10.2: "a typical freelancer workspace with thousands of records").
//   API=http://localhost:4000 node ops/perf/seed-large.mjs [scale=1]
const API = process.env.API ?? 'http://localhost:4000';
const SCALE = Number(process.argv[2] ?? 1);
const PW = 'a very long password 1';
let token;
const call = async (method, url, body) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null;
};
const pool = async (n, items, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const pick = (a, i) => a[i % a.length];
const t0 = Date.now();

token = (await call('POST', '/auth/setup', { name: 'Gorakh Chavan', email: 'owner@example.com', password: PW, workspaceName: 'Gorakh Studio' })).accessToken;
const stages = await call('GET', '/pipeline/stages');
const N = { clients: 300 * SCALE, engagementsPer: 2, proposals: 400 * SCALE, projects: 150 * SCALE, tasksPer: 20, invoices: 1500 * SCALE, payments: 800 * SCALE };
const words = ['Billing', 'Portal', 'Brand', 'Store', 'Loyalty', 'Analytics', 'Booking', 'Inventory', 'Mobile', 'Payments', 'Onboarding', 'Dashboard'];

const clients = await pool(12, Array.from({ length: N.clients }, (_, i) => i), (i) => call('POST', '/clients', { type: 'COMPANY', name: `${pick(words, i)} ${pick(['Labs', 'Retail', 'Studio', 'Foods', 'Health', 'Travel'], i >> 2)} ${i}`, email: `hello${i}@client${i}.test`, primaryContact: { firstName: `Contact${i}`, lastName: 'Person', email: `c${i}@client${i}.test` } }));
console.log('clients', clients.length, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
await pool(12, clients.flatMap((c, i) => Array.from({ length: N.engagementsPer }, (_, j) => [c, i * 2 + j])), ([c, k]) => call('POST', '/engagements', { clientId: c.id, title: `${pick(words, k)} engagement ${k}`, estimatedValue: `${(k % 50 + 1) * 10000}.00`, currency: 'INR', stageId: stages[k % stages.length].id }));
console.log('engagements', `${((Date.now() - t0) / 1000).toFixed(0)}s`);

const CONTENT = (rate) => ({ pricingModel: 'FIXED', currency: 'INR', validUntil: day(30), summary: 'Scope.', sections: [{ kind: 'SCOPE', title: 'Scope', body: 'Work.' }], lineItems: [{ description: 'Build', quantity: '1', unitRate: rate, taxBps: 1800 }], paymentTerms: [{ label: 'On completion', kind: 'ON_COMPLETION', percentageBps: 10000 }] });
await pool(10, Array.from({ length: N.proposals }, (_, i) => i), async (i) => {
  const p = await call('POST', '/proposals', { clientId: pick(clients, i).id, title: `${pick(words, i)} proposal ${i}` });
  await call('PUT', `/proposals/${p.id}/versions/1`, CONTENT(`${(i % 40 + 1) * 5000}`));
  if (i % 3 !== 0) await call('POST', `/proposals/${p.id}/versions/1/share`);
});
console.log('proposals', `${((Date.now() - t0) / 1000).toFixed(0)}s`);

const projects = await pool(8, Array.from({ length: N.projects }, (_, i) => i), async (i) => {
  const pr = await call('POST', '/projects', { clientId: pick(clients, i).id, name: `${pick(words, i)} project ${i}` });
  const ms = [];
  for (let m = 0; m < 4; m++) ms.push(await call('POST', `/projects/${pr.id}/milestones`, { name: `Milestone ${m + 1}`, dueDate: day((i % 60) - 20 + m * 10) }));
  for (let t = 0; t < N.tasksPer; t++) await call('POST', `/projects/${pr.id}/tasks`, { title: `Task ${t + 1} of ${i}`, milestoneId: ms[t % 4].id, dueDate: day((t + i) % 50 - 10), ...(t % 3 === 0 ? { visibility: 'CLIENT_VISIBLE' } : {}) });
  return pr;
});
console.log('projects + tasks', projects.length * N.tasksPer, `${((Date.now() - t0) / 1000).toFixed(0)}s`);

const invoices = await pool(12, Array.from({ length: N.invoices }, (_, i) => i), async (i) => {
  const c = pick(clients, i);
  const inv = await call('POST', '/invoices', { clientId: c.id, currency: 'INR', paymentTermsDays: 15 + (i % 3) * 15, lines: [{ description: 'Milestone payment', quantity: '1', unitRate: `${(i % 20 + 1) * 2500}`, taxBps: 1800 }, { description: 'Hosting', quantity: '3', unitRate: '1500', taxBps: 1800 }] });
  if (i % 10 !== 0) await call('POST', `/invoices/${inv.id}/issue`, {});
  return { id: inv.id, clientId: c.id, issued: i % 10 !== 0 };
});
console.log('invoices', invoices.length, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
const issued = invoices.filter((x) => x.issued);
await pool(12, Array.from({ length: Math.min(N.payments, issued.length) }, (_, i) => i), async (i) => {
  const inv = issued[i];
  const p = await call('POST', '/payments', { clientId: inv.clientId, amount: '1000.00', currency: 'INR', receivedAt: day(-(i % 90)), method: pick(['BANK_TRANSFER', 'UPI', 'CARD'], i) });
  await call('POST', `/payments/${p.id}/allocations`, { allocations: [{ invoiceId: inv.id, amount: '1000.00' }] });
});
console.log('payments', `${((Date.now() - t0) / 1000).toFixed(0)}s`);

const docs = await pool(8, Array.from({ length: 300 * SCALE }, (_, i) => i), async (i) => {
  const form = new FormData();
  form.append('file', new Blob([`%PDF-1.4\n% document ${i}\n%%EOF\n`], { type: 'application/pdf' }), `doc-${i}.pdf`);
  form.append('clientId', pick(clients, i).id); form.append('title', `${pick(words, i)} document ${i}`);
  const r = await fetch(API + '/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
  if (!r.ok) throw new Error('upload ' + r.status);
  return r.json();
});
console.log('documents', docs.length, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(JSON.stringify({ project: projects[0].id, client: clients[0].id }));
