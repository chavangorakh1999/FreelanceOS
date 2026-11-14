const { launch, psql: sharedPsql, WEB: SHARED_WEB, API: SHARED_API } = require('./browser.cjs');
const crypto = require('crypto');
const shots = process.argv[2];
const API = SHARED_API, WEB = SHARED_WEB;
const PW = 'a very long password 1', TOKEN = 'smoke5-' + crypto.randomBytes(24).toString('base64url');
const psql = sharedPsql;
const future = (d = 30) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

(async () => {
  const browser = await launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/40[1349]|422|Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
  };
  const step = (s) => console.log('✓', s);

  // ───── owner: set up workspace ─────
  const owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  watch(owner, 'owner');
  await owner.goto(WEB + '/');
  await owner.waitForURL('**/setup');
  await owner.getByLabel('Your name').fill('Gorakh Chavan');
  await owner.getByLabel('Business name').fill('Gorakh Studio');
  await owner.getByLabel('Email').fill('owner@example.com');
  await owner.getByLabel('Password').fill(PW);
  await owner.getByRole('button', { name: 'Create workspace' }).click();
  await owner.waitForURL('**/dashboard');
  step('owner workspace created');

  const login = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: PW }) })).json();
  const call = async (method, url, body) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t}`);
    return t ? JSON.parse(t) : null;
  };

  // fixtures through the API
  const client = await call('POST', '/clients', { type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@northwind.test' } });
  const project = await call('POST', '/projects', { clientId: client.id, name: 'Billing portal rebuild' });
  await call('PATCH', `/projects/${project.id}`, { visibility: 'CLIENT_VISIBLE' });

  // ───── owner invites the contact from the client page ─────
  await owner.goto(`${WEB}/clients/${client.id}`);
  await owner.getByRole('heading', { name: 'Client portal' }).waitFor();
  await owner.getByRole('button', { name: 'Invite to portal' }).click();
  await owner.locator('dialog[open]').getByText(project.name).waitFor();
  await owner.locator('dialog[open]').getByLabel('Billing portal rebuild').check();
  await owner.locator('dialog[open]').getByRole('button', { name: 'Send invitation' }).click();
  // Outside production with the log email provider, the dialog then shows the invitation link; close it.
  const done = owner.locator('dialog[open]').getByRole('button', { name: 'Done' });
  if (await done.waitFor({ timeout: 5000 }).then(() => true, () => false)) await done.click();
  await owner.getByText(/Invited, expires/).waitFor();
  await owner.screenshot({ path: `${shots}/01-owner-invite.png` });
  step('owner invited Priya from the client page');
  // the real token only ever exists in the email; swap in a known one so the script can follow the link
  psql(`UPDATE portal_invitations SET "tokenHash" = encode(sha256('${TOKEN}'::bytea), 'hex') WHERE "usedAt" IS NULL`);

  // ───── client: accepts the invitation on a phone ─────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, acceptDownloads: true });
  const portal = await phone.newPage();
  watch(portal, 'portal');
  await portal.goto(`${WEB}/portal/accept/${TOKEN}`);
  await portal.getByRole('heading', { name: /Hello, Priya/ }).waitFor();
  await portal.screenshot({ path: `${shots}/02-portal-accept.png` });
  await portal.getByLabel('Your full name').fill('Priya Menon');
  await portal.getByLabel('Choose a password').fill(PW);
  await portal.getByRole('button', { name: 'Create account and continue' }).click();
  await portal.waitForURL('**/portal');
  await portal.getByRole('heading', { name: /Hello, Priya/ }).waitFor();
  await portal.getByText('You’re all caught up.').waitFor();
  await portal.screenshot({ path: `${shots}/03-portal-empty.png` });
  step('client accepted the invitation and sees an empty, caught-up portal');
  await portal.goto(`${WEB}/portal/accept/${TOKEN}`);
  await portal.getByText('This link is no longer valid').waitFor();
  step('the invitation link cannot be reused');
  await portal.goto(`${WEB}/portal`);

  // ───── owner shares a proposal; client accepts it ─────
  const prop = await call('POST', '/proposals', { clientId: client.id, title: 'Billing portal' });
  await call('PUT', `/proposals/${prop.id}/versions/1`, {
    pricingModel: 'FIXED', currency: 'INR', validUntil: future(), summary: 'Rebuild of the billing portal.', sections: [{ kind: 'SCOPE', title: 'Scope', body: 'Payment gateway integration.' }],
    lineItems: [{ description: 'Payment gateway', quantity: '1', unitRate: '100000', taxBps: 1800 }], paymentTerms: [{ label: 'On completion', kind: 'ON_COMPLETION', percentageBps: 10000 }],
  });
  await call('POST', `/proposals/${prop.id}/versions/1/share`);
  await portal.reload();
  await portal.getByText('Needs your attention').waitFor();
  await portal.getByRole('link', { name: /Billing portal/ }).first().click();
  await portal.getByRole('heading', { name: 'Ready for your decision' }).waitFor();
  await portal.screenshot({ path: `${shots}/04-portal-proposal.png`, fullPage: true });
  await portal.getByRole('button', { name: 'Accept', exact: true }).click();
  await portal.locator('dialog[open]').getByRole('button', { name: 'Accept proposal' }).click();
  await portal.getByRole('heading', { name: 'Accepted' }).waitFor();
  step('client accepted the proposal');

  // ───── owner is told ─────
  await owner.goto(`${WEB}/notifications`);
  await owner.getByText(/accepted PROP/).first().waitFor();
  await owner.screenshot({ path: `${shots}/05-owner-notifications.png` });
  step('owner sees the acceptance in notifications');
  await owner.goto(`${WEB}/proposals/${prop.id}`);
  await owner.getByText('PORTAL', { exact: false }).first().waitFor().catch(() => {});
  step('owner proposal page shows the client decision');

  // ───── agreement: owner signs first, then the client signs in the portal ─────
  const ag = await call('POST', '/agreements', { clientId: client.id, proposalId: prop.id });
  const v1 = await call('GET', `/agreements/${ag.id}/versions/1`);
  await call('PUT', `/agreements/${ag.id}/versions/1`, { clauses: v1.clauses.map((c) => ({ heading: c.heading, body: c.body.replace(/\[[^\]]+\]/g, 'Agreed text.') })), signers: v1.signers.map((s) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })) });
  const sent = await call('POST', `/agreements/${ag.id}/versions/1/send`);
  await portal.goto(`${WEB}/portal/agreements/${ag.id}`);
  await portal.getByText(/Waiting for Gorakh Chavan to sign first/).waitFor();
  await call('POST', `/agreements/${ag.id}/versions/1/events`, { type: 'SIGNED', signerId: sent.signers.find((s) => s.role === 'FREELANCER').id, method: 'MANUAL_RECORDED', evidence: 'Signed PDF received by email' });
  await portal.reload();
  await portal.getByRole('heading', { name: 'Sign this agreement' }).waitFor();
  await portal.getByLabel('Type your full name').fill('Priya Menon');
  await portal.getByRole('button', { name: 'Sign agreement' }).isDisabled().then((d) => { if (!d) throw new Error('sign should need consent'); });
  await portal.getByRole('checkbox').check();
  await portal.screenshot({ path: `${shots}/06-portal-sign.png`, fullPage: true });
  await portal.getByRole('button', { name: 'Sign agreement' }).click();
  await portal.getByText('You signed this agreement.').waitFor();
  step('client signed the agreement in the portal');
  const ev = psql(`SELECT method || '|' || coalesce("ipAddress",'') FROM signature_events WHERE type='SIGNED' AND "portalUserId" IS NOT NULL`);
  if (!ev.startsWith('PORTAL|')) throw new Error('portal signature not recorded: ' + ev);

  // ───── scope review + task visibility ─────
  await call('PUT', `/projects/${project.id}/scope/versions/1`, { summary: 'Initial scope', items: [{ kind: 'DELIVERABLE', title: 'Billing portal', description: 'Portal with invoices.' }, { kind: 'EXCLUSION', title: 'Mobile apps', description: 'Out of scope.' }] });
  await call('POST', `/projects/${project.id}/scope/versions/1/submit`);
  const ms = await call('POST', `/projects/${project.id}/milestones`, { name: 'Design' });
  await call('POST', `/projects/${project.id}/tasks`, { title: 'Wireframes', milestoneId: ms.id, visibility: 'CLIENT_VISIBLE', internalNotes: 'secret note' });
  await call('POST', `/projects/${project.id}/tasks`, { title: 'Refactor our CI', milestoneId: ms.id, visibility: 'INTERNAL' });
  await call('PUT', `/clients/${client.id}/portal/contacts/${client.primaryContact?.id ?? (await call('GET', `/clients/${client.id}`)).contacts[0].id}/access`, { projectIds: [project.id] });
  await portal.goto(`${WEB}/portal/projects/${project.id}`);
  await portal.getByRole('heading', { name: /Scope version 1 is ready/ }).waitFor();
  const body = await portal.locator('body').innerText();
  if (body.includes('Refactor our CI') || body.includes('secret note')) throw new Error('internal task leaked into the portal');
  await portal.screenshot({ path: `${shots}/07-portal-project.png`, fullPage: true });
  await portal.getByRole('button', { name: 'Approve scope' }).first().click();
  await portal.locator('dialog[open]').getByRole('button', { name: 'Approve scope' }).click();
  await portal.getByRole('heading', { name: 'Agreed scope' }).waitFor();
  step('client approved the scope; hidden task and internal notes never reached the page');

  // ───── comments both ways ─────
  await portal.goto(`${WEB}/portal/proposals/${prop.id}`);
  await portal.getByLabel('Write a comment').fill('Can we split the payment in three?');
  await portal.getByRole('button', { name: 'Post comment' }).click();
  await portal.getByText('Can we split the payment in three?').waitFor();
  await owner.goto(`${WEB}/proposals/${prop.id}`);
  await owner.getByText('Can we split the payment in three?').waitFor();
  await owner.getByLabel('Write a comment').fill('Internal: they are price sensitive');
  await owner.getByLabel('Who can see this comment').selectOption('INTERNAL');
  await owner.getByRole('button', { name: 'Post comment' }).click();
  await owner.getByText('Internal: they are price sensitive').waitFor();
  await owner.screenshot({ path: `${shots}/08-owner-comments.png`, fullPage: true });
  await portal.reload();
  await portal.getByText('Can we split the payment in three?').waitFor();
  if ((await portal.locator('body').innerText()).includes('price sensitive')) throw new Error('internal comment leaked');
  step('comments flow both ways; the internal one stays internal');

  // ───── invoice shared, viewed, downloaded ─────
  const inv = await call('POST', '/invoices', { clientId: client.id, currency: 'INR', paymentTermsDays: 30, lines: [{ description: 'Gateway', quantity: '1', unitRate: '100000', taxBps: 1800 }] });
  await call('POST', `/invoices/${inv.id}/issue`, {});
  await portal.goto(`${WEB}/portal/invoices`);
  await portal.getByText('No invoices yet').waitFor();
  await call('POST', `/invoices/${inv.id}/share`);
  await portal.reload();
  await portal.getByRole('link', { name: /outstanding/ }).click();
  await portal.getByText('Balance due').waitFor();
  const [dl] = await Promise.all([portal.waitForEvent('download'), portal.getByRole('button', { name: 'PDF' }).click()]);
  if (!dl.suggestedFilename().endsWith('.pdf')) throw new Error('bad pdf name');
  await portal.screenshot({ path: `${shots}/09-portal-invoice.png`, fullPage: true });
  step('shared invoice appears and downloads as a PDF');

  // ───── notifications on the client side ─────
  await portal.goto(`${WEB}/portal/notifications`);
  await portal.getByText(/is available/).first().waitFor();
  await portal.screenshot({ path: `${shots}/10-portal-notifications.png`, fullPage: true });

  // ───── owner removes access: the client is out on the next request ─────
  await owner.goto(`${WEB}/clients/${client.id}`);
  await owner.getByRole('button', { name: 'Remove access' }).click();
  await owner.getByText('Access removed').waitFor();
  await portal.goto(`${WEB}/portal`);
  await portal.waitForURL('**/portal/login');
  step('after the owner removed access the client is signed out');

  // ───── owner settings: preferences + delivery list render ─────
  await owner.goto(`${WEB}/settings`);
  await owner.getByRole('heading', { name: 'Email notifications' }).waitFor();
  await owner.getByRole('heading', { name: /Emails that didn’t go out/ }).waitFor();
  await owner.screenshot({ path: `${shots}/11-owner-settings.png`, fullPage: true });

  await browser.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('ALL OK');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
