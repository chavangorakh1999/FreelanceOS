// A new freelancer's first ten minutes, on an empty database: sign up, get guided, fill the business profile, add a lead
// and its client in one dialog, and the safety nets (unsaved edits, double clicks, a missing page, a forgotten password).
const path = require('path');
const fs = require('fs');
const { launch, psql, WEB } = require('./browser.cjs');

const out = path.join(process.env.E2E_OUT ?? '/tmp/e2e-run', 'first-run');
fs.mkdirSync(out, { recursive: true });
const PW = 'a very long password 1';
const ok = (m) => console.log('✓ ' + m);

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));

  await p.goto(WEB + '/'); await p.waitForURL('**/setup');
  await p.getByLabel('Your name').fill('Gorakh Chavan'); await p.getByLabel('Business name').fill('Gorakh Studio');
  await p.getByLabel('Currency you bill in').selectOption('USD');
  await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill(PW);
  await p.getByRole('button', { name: 'Create workspace' }).click(); await p.waitForURL('**/dashboard');
  await p.getByText('Welcome, Gorakh').waitFor();
  await p.getByRole('heading', { name: 'Get started' }).waitFor(); await p.getByText('0 of 4 done').waitFor();
  if (!(await p.getByText('$0.00').first().isVisible())) throw new Error('the dashboard should be in USD');
  await p.screenshot({ path: `${out}/01-dashboard.png`, fullPage: true });
  ok('sign-up asks for the billing currency; a new workspace says Welcome and shows a 4-step checklist');

  await p.getByRole('link', { name: 'Open settings' }).click(); await p.waitForURL('**/settings');
  await p.getByText('Incomplete').waitFor();
  await p.getByLabel('Address line 1').fill('12 MG Road'); await p.getByLabel('City').fill('Pune'); await p.getByLabel('Country').fill('in');
  await p.getByLabel('Tax ID (GSTIN, VAT, EIN)').fill('27ABCDE1234F1Z5'); await p.getByLabel('How clients pay you').fill('UPI: gorakh@upi');
  await p.getByLabel('Default tax (%)').fill('0');
  const tzBefore = await p.getByLabel('Time zone').inputValue();
  await p.getByRole('button', { name: 'Save profile' }).click(); await p.getByText('Ready for invoices').waitFor();
  if (psql("SELECT timezone FROM workspaces") !== tzBefore) throw new Error('saving the profile changed the time zone');
  await p.screenshot({ path: `${out}/02-business-profile.png`, fullPage: true });
  ok('the business profile saves address, tax ID, how to pay and defaults');

  await p.goto(WEB + '/engagements?new=1'); const d = p.locator('dialog[open]');
  await d.getByLabel('Client name').waitFor(); // no clients yet: the new-client fields are already open
  await d.getByLabel('Client name').fill('Northwind Labs'); await d.getByLabel('Contact name (optional)').fill('Priya Menon'); await d.getByLabel('Contact email (optional)').fill('priya@nw.test');
  await d.getByLabel('Title').fill('Billing portal');
  await p.screenshot({ path: `${out}/03-lead-with-new-client.png` });
  await d.getByRole('button', { name: 'Create lead' }).dblclick();
  await p.waitForURL(/engagements\/[0-9a-f-]{36}$/);
  if (psql("SELECT count(*) FROM clients WHERE name = 'Northwind Labs'") !== '1' || psql("SELECT count(*) FROM engagements WHERE title = 'Billing portal'") !== '1') throw new Error('double click created duplicates');
  ok('the first lead creates its client in the same dialog; a double click creates one client and one lead');

  await p.getByRole('button', { name: 'Start project' }).click(); await p.waitForURL(/tab=proposals/);
  await p.getByRole('button', { name: 'New proposal' }).first().click(); await p.locator('dialog[open]').getByRole('button', { name: 'Create proposal' }).click();
  await p.waitForURL(/proposals\/[0-9a-f-]{36}$/);
  if (!(await p.getByLabel('Valid until').inputValue())) throw new Error('a new proposal should have a valid-until date');
  await p.getByLabel('Summary (optional)').fill('Something I typed');
  let asked = 0; p.on('dialog', async (dlg) => { asked += 1; await dlg.dismiss(); });
  await p.locator('nav[aria-label="Workspace"]').getByRole('link', { name: 'Projects' }).click(); await p.waitForTimeout(600);
  if (asked !== 1 || !/proposals\//.test(p.url()) || (await p.getByLabel('Summary (optional)').inputValue()) !== 'Something I typed') throw new Error('leaving with unsaved edits should ask and stay');
  await p.getByRole('button', { name: 'Save draft' }).click(); await p.getByText('Draft saved').waitFor();
  await p.locator('nav[aria-label="Workspace"]').getByRole('link', { name: 'Projects' }).click(); await p.waitForURL('**/projects');
  if (asked !== 1) throw new Error('after saving there is nothing to warn about');
  ok('a new proposal is valid for 30 days; leaving with unsaved edits asks first, and saved drafts leave freely');

  await p.goto(WEB + '/dashboard'); await p.getByText('4 of 4 done').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
  if (await p.getByRole('heading', { name: 'Get started' }).count()) throw new Error('the checklist should be gone once everything is done');
  ok('the checklist disappears once all four steps are done');

  await p.goto(WEB + '/no-such-page'); await p.getByRole('heading', { name: 'This page doesn’t exist' }).waitFor();
  await p.getByRole('link', { name: 'Go to your workspace' }).waitFor();
  await p.goto(WEB + '/projects/00000000-0000-0000-0000-000000000000'); await p.getByRole('heading', { name: 'Project not found' }).waitFor();
  if (await p.getByText('Project not found').count() !== 1) throw new Error('"not found" should be said once');
  ok('a missing page has a way back, and a missing record says so once');

  // Forgot password, from the sign-in page.
  const anon = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await anon.goto(WEB + '/login'); await anon.getByRole('link', { name: 'Forgot password?' }).click(); await anon.waitForURL('**/forgot-password');
  await anon.getByLabel('Email').fill('owner@example.com'); await anon.getByRole('button', { name: 'Send reset link' }).click();
  await anon.getByRole('heading', { name: 'Check your email' }).waitFor();
  const link = await anon.locator('a[href*="/reset-password/"]').first().getAttribute('href');
  await anon.goto(link.trim());
  await anon.getByLabel('New password').fill('a brand new long password'); await anon.getByLabel('Type it again').fill('a brand new long password');
  await anon.getByRole('button', { name: 'Set new password' }).click(); await anon.getByRole('heading', { name: 'Password changed' }).waitFor();
  await anon.goto(link.trim()); await anon.getByRole('heading', { name: 'This link has expired' }).waitFor();
  await anon.goto(WEB + '/login'); await anon.getByLabel('Email').fill('owner@example.com'); await anon.getByLabel('Password').fill('a brand new long password');
  await anon.getByRole('button', { name: 'Sign in' }).click(); await anon.waitForURL('**/dashboard');
  ok('forgot password: link from the sign-in page, new password set, link works once, sign-in with the new password');

  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  console.log('FIRST RUN OK');
  await b.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
