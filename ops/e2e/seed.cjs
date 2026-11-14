// Seeds a realistic workspace through the public API (used for the UX walk-through).
const API = process.env.API_URL ?? 'http://localhost:4000', PW = 'a very long password 1';
const future = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
let token;
const call = async (method, url, body) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t}`); return t ? JSON.parse(t) : null;
};
const PROPOSAL = (rate) => ({ pricingModel: 'FIXED', currency: 'INR', validUntil: future(30), summary: 'Rebuild of the customer billing portal.', sections: [{ kind: 'SCOPE', title: 'Scope', body: 'Payment gateway integration and invoices.' }], lineItems: [{ description: 'Build', quantity: '1', unitRate: rate, taxBps: 1800 }], paymentTerms: [{ label: 'On completion', kind: 'ON_COMPLETION', percentageBps: 10000 }] });
(async () => {
  token = (await call('POST', '/auth/setup', { name: 'Gorakh Chavan', email: 'owner@example.com', password: PW, workspaceName: 'Gorakh Studio' })).accessToken;
  const stages = await call('GET', '/pipeline/stages');
  const clients = [];
  for (const [name, first, last] of [['Northwind Labs', 'Priya', 'Menon'], ['Acme Retail', 'Rahul', 'Shah'], ['Blue Fern Studio', 'Ananya', 'Iyer']]) {
    clients.push(await call('POST', '/clients', { type: 'COMPANY', name, email: `hello@${name.toLowerCase().replace(/\W/g, '')}.test`, primaryContact: { firstName: first, lastName: last, email: `${first.toLowerCase()}@${name.toLowerCase().replace(/\W/g, '')}.test` } }));
  }
  const [nw, acme, fern] = clients;
  for (const [c, title, val, si] of [[nw, 'Billing portal rebuild', '250000.00', 3], [acme, 'Store locator', '90000.00', 1], [fern, 'Brand site', '120000.00', 0], [acme, 'Loyalty app discovery', '60000.00', 2]]) {
    await call('POST', '/engagements', { clientId: c.id, title, estimatedValue: val, currency: 'INR', stageId: stages[si].id });
  }
  // proposals: accepted, shared, draft
  const p1 = await call('POST', '/proposals', { clientId: nw.id, title: 'Billing portal rebuild' });
  await call('PUT', `/proposals/${p1.id}/versions/1`, PROPOSAL('200000')); await call('POST', `/proposals/${p1.id}/versions/1/share`);
  await call('POST', `/proposals/${p1.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' });
  const p2 = await call('POST', '/proposals', { clientId: acme.id, title: 'Store locator' });
  await call('PUT', `/proposals/${p2.id}/versions/1`, PROPOSAL('75000')); await call('POST', `/proposals/${p2.id}/versions/1/share`);
  await call('POST', '/proposals', { clientId: fern.id, title: 'Brand site' });
  // agreement signed by both
  const ag = await call('POST', '/agreements', { clientId: nw.id, proposalId: p1.id });
  const v1 = await call('GET', `/agreements/${ag.id}/versions/1`);
  await call('PUT', `/agreements/${ag.id}/versions/1`, { clauses: v1.clauses.map((c) => ({ heading: c.heading, body: c.body.replace(/\[[^\]]+\]/g, 'Agreed text.') })), signers: v1.signers.map((s) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })) });
  const sent = await call('POST', `/agreements/${ag.id}/versions/1/send`);
  for (const s of sent.signers) await call('POST', `/agreements/${ag.id}/versions/1/events`, { type: 'SIGNED', signerId: s.id, method: 'MANUAL_RECORDED', evidence: 'Signed PDF by email' });
  // project with approved scope, milestones, tasks, change request
  const pr = await call('POST', '/projects', { clientId: nw.id, proposalId: p1.id, agreementId: ag.id, name: 'Billing portal rebuild' });
  await call('PUT', `/projects/${pr.id}/scope/versions/1`, { summary: 'Initial scope', items: [{ kind: 'DELIVERABLE', title: 'Billing portal', description: 'Portal with invoices.' }, { kind: 'FEATURE', title: 'Payment gateway', description: 'Cards and UPI.' }, { kind: 'EXCLUSION', title: 'Mobile apps', description: 'Out of scope.' }] });
  await call('POST', `/projects/${pr.id}/scope/versions/1/submit`);
  await call('POST', `/projects/${pr.id}/scope/versions/1/decision`, { decision: 'APPROVED', channel: 'EMAIL', approverName: 'Priya Menon' });
  await call('PATCH', `/projects/${pr.id}`, { status: 'ACTIVE' });
  const m1 = await call('POST', `/projects/${pr.id}/milestones`, { name: 'Design', dueDate: future(10) });
  const m2 = await call('POST', `/projects/${pr.id}/milestones`, { name: 'Build', dueDate: future(40) });
  for (const [t, m, st] of [['Wireframes', m1, 'DONE'], ['Visual design', m1, 'IN_PROGRESS'], ['Gateway integration', m2, 'TODO'], ['Invoice PDFs', m2, 'TODO']]) {
    const task = await call('POST', `/projects/${pr.id}/tasks`, { title: t, milestoneId: m.id });
    if (st !== 'TODO') await call('PATCH', `/tasks/${task.id}`, { status: st === 'DONE' ? 'IN_PROGRESS' : st }).then(() => st === 'DONE' && call('PATCH', `/tasks/${task.id}`, { status: 'DONE' }));
  }
  const cr = await call('POST', `/projects/${pr.id}/change-requests`, { title: 'Add refunds', description: 'Refund flow for card payments', reason: 'Customers ask for it', requestedBy: 'CLIENT', requesterName: 'Priya Menon' });
  await call('POST', `/change-requests/${cr.id}/assessment`, { costDelta: '20000.00', currency: 'INR', timelineDeltaDays: 5, deliverablesImpact: 'Adds a refund workflow', dependenciesImpact: 'Gateway first', risk: 'MEDIUM', requiresAddendum: false });
  await call('POST', '/projects', { clientId: acme.id, name: 'Store locator' });
  // invoices: paid, partly paid, draft
  const mk = async (c, rate, issue) => { const inv = await call('POST', '/invoices', { clientId: c.id, currency: 'INR', paymentTermsDays: 15, lines: [{ description: 'Milestone payment', quantity: '1', unitRate: rate, taxBps: 1800 }] }); if (issue) await call('POST', `/invoices/${inv.id}/issue`, {}); return inv; };
  const i1 = await mk(nw, '100000', true); const i2 = await mk(nw, '50000', true); await mk(acme, '30000', false); await mk(fern, '40000', true);
  const pay = await call('POST', '/payments', { clientId: nw.id, amount: '138000.00', currency: 'INR', receivedAt: new Date().toISOString().slice(0, 10), method: 'BANK_TRANSFER', reference: 'UTR123' });
  await call('POST', `/payments/${pay.id}/allocations`, { allocations: [{ invoiceId: i1.id, amount: '118000.00' }, { invoiceId: i2.id, amount: '20000.00' }] });
  console.log(JSON.stringify({ client: nw.id, proposal: p1.id, proposal2: p2.id, agreement: ag.id, project: pr.id, cr: cr.id, invoice: i2.id, payment: pay.id }));
})().catch((e) => { console.error(e.message); process.exit(1); });
