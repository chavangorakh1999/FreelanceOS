const { launch, psql: sharedPsql, WEB: SHARED_WEB, API: SHARED_API } = require('./browser.cjs');
const crypto = require('crypto');
const fs = require('fs');
const S = process.argv[2]; const ids = require(S + '/ids.json'); const out = S + '/phase6'; fs.mkdirSync(out, { recursive: true });
const WEB = SHARED_WEB, API = SHARED_API, PW = 'a very long password 1';
const psql = sharedPsql;
(async () => {
  const b = await launch(); const errors = [];
  const ok = (s) => console.log('✓', s);
  const owner = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  owner.on('pageerror', (e) => errors.push('owner: ' + e.message));
  await owner.goto(WEB + '/login'); await owner.getByLabel('Email').fill('owner@example.com'); await owner.getByLabel('Password').fill(PW);
  await owner.getByRole('button', { name: 'Sign in' }).click(); await owner.waitForURL('**/dashboard');

  // upload from the client hub, attached to that client
  await owner.goto(`${WEB}/clients/${ids.client}?tab=documents`);
  await owner.getByRole('heading', { name: 'Documents' }).waitFor(); await owner.getByText('No documents yet').waitFor();
  await owner.getByRole('button', { name: 'Upload' }).click();
  const dlg = owner.locator('dialog[open]');
  await dlg.getByLabel('File').setInputFiles(S + '/brief.pdf');
  if ((await dlg.getByLabel('Title').inputValue()) !== 'brief') throw new Error('title should default from the file name');
  await dlg.getByLabel('Title').fill('Project brief'); await dlg.getByLabel('Category').selectOption('BRIEF');
  await dlg.getByRole('button', { name: 'Upload' }).click(); await dlg.waitFor({ state: 'hidden' });
  await owner.getByRole('link', { name: 'Project brief' }).waitFor(); ok('uploaded a PDF from the client page; it is listed there');

  // a refused file says why
  await owner.getByRole('button', { name: 'Upload' }).click();
  fs.writeFileSync(S + '/evil.pdf', 'MZ\x90\x00 not really a pdf');
  await dlg.getByLabel('File').setInputFiles(S + '/evil.pdf'); await dlg.getByRole('button', { name: 'Upload' }).click();
  await dlg.getByText(/Upload a PDF, an image/).waitFor(); ok('a disguised executable is refused with a clear message');
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  // detail: new version, download, share
  await owner.locator('tbody tr').filter({ hasText: 'Project brief' }).locator('td').nth(2).click();
  await owner.waitForURL(/\/documents\/[0-9a-f-]{36}$/); const docId = owner.url().split('/').pop();
  await owner.getByRole('button', { name: 'New version' }).click();
  await dlg.getByLabel('File').setInputFiles(S + '/brief-v2.pdf'); await dlg.getByLabel('What changed (optional)').fill('Client comments');
  await dlg.getByRole('button', { name: 'Add version' }).click(); await owner.getByText('Client comments').waitFor();
  const [dl] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'Download version 1' }).click()]);
  const bytes = fs.readFileSync(await dl.path()); if (!bytes.equals(fs.readFileSync(S + '/brief.pdf'))) throw new Error('version 1 bytes differ');
  await owner.getByText(/Gorakh Chavan.*downloaded v1|downloaded v1/).first().waitFor(); ok('added version 2; version 1 still downloads byte-for-byte and the download is logged');
  await owner.getByRole('button', { name: 'Share with client' }).click(); await dlg.getByRole('button', { name: 'Share' }).click();
  await owner.getByText('Shared with client').first().waitFor();
  await owner.screenshot({ path: `${out}/document.png`, fullPage: true }); ok('shared the document with the client');

  // client signs in to the portal and downloads the current version
  const login = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: PW }) })).json();
  const client = await (await fetch(`${API}/clients/${ids.client}`, { headers: { Authorization: 'Bearer ' + login.accessToken } })).json();
  await fetch(`${API}/clients/${ids.client}/portal/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: JSON.stringify({ contactId: client.contacts[0].id, role: 'VIEWER' }) });
  const TOKEN = 'p6-' + crypto.randomBytes(24).toString('base64url');
  psql(`UPDATE portal_invitations SET "tokenHash" = encode(sha256('${TOKEN}'::bytea), 'hex') WHERE "usedAt" IS NULL`);
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, acceptDownloads: true });
  const portal = await phone.newPage(); portal.on('pageerror', (e) => errors.push('portal: ' + e.message));
  await portal.goto(`${WEB}/portal/accept/${TOKEN}`); await portal.getByLabel('Your full name').fill('Priya Menon'); await portal.getByLabel('Choose a password').fill(PW);
  await portal.getByRole('button', { name: 'Create account and continue' }).click(); await portal.waitForURL('**/portal');
  await portal.getByRole('navigation', { name: 'Portal sections' }).getByRole('link', { name: 'Documents' }).click();
  await portal.getByText('Project brief').waitFor();
  const [pdl] = await Promise.all([portal.waitForEvent('download'), portal.getByRole('button', { name: 'Download Project brief' }).click()]);
  if (!fs.readFileSync(await pdl.path()).equals(fs.readFileSync(S + '/brief-v2.pdf'))) throw new Error('client should get the current version');
  await portal.screenshot({ path: `${out}/portal-documents.png` }); ok('the client finds it under Documents on a phone and downloads the current version');
  await owner.reload(); await owner.getByText(/Priya Menon/).first().waitFor(); ok('the owner sees the client download in the access history');

  // calendar
  // The seeded Design milestone is due in 10 days, which late in a month falls in the next one: open its month.
  const designMonth = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 7);
  await owner.goto(`${WEB}/calendar?month=${designMonth}`); await owner.getByRole('link', { name: /^Design/ }).first().waitFor();
  await owner.screenshot({ path: `${out}/calendar-month.png` }); ok('month view shows the Design milestone');
  await owner.getByLabel('Milestones').uncheck(); await owner.getByRole('link', { name: /^Design/ }).first().waitFor({ state: 'detached' }); ok('type filter hides milestones');
  await owner.getByLabel('Milestones').check();
  await owner.getByRole('button', { name: 'Agenda' }).click(); await owner.waitForURL(/view=agenda/);
  // Seeded invoices fall due 15 days after today, which late in a month is next month.
  const due = owner.getByText(/INV\/\d{2}-\d{2}\/\d+ due/).first();
  if (!(await due.waitFor({ timeout: 5000 }).then(() => true, () => false))) { await owner.getByRole('button', { name: 'Next month' }).click(); await due.waitFor(); }
  await owner.screenshot({ path: `${out}/calendar-agenda.png`, fullPage: true }); ok('agenda view lists invoice due dates; the view is kept in the URL');
  const [ics] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'Export .ics' }).click()]);
  const text = fs.readFileSync(await ics.path(), 'utf8'); if (!text.startsWith('BEGIN:VCALENDAR') || !text.includes('SUMMARY:Design')) throw new Error('bad ics');
  ok('.ics export downloads with the events');
  await owner.getByRole('button', { name: 'Next month' }).click(); await owner.waitForURL(/month=\d{4}-\d{2}/); ok('month navigation updates the URL');

  // search finds the document
  await owner.locator('main').click({ position: { x: 5, y: 5 } }); await owner.keyboard.press('Control+k');
  await owner.getByRole('combobox', { name: 'Search everything' }).fill('project brief'); await owner.getByRole('option', { name: /Project brief/ }).click();
  await owner.waitForURL(`**/documents/${docId}`); ok('global search finds the document');

  await b.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('PHASE 6 OK');
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
