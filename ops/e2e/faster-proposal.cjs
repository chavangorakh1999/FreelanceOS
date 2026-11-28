// A priced proposal with as little typing as possible: save a good proposal as a template, start the next one from it,
// re-price a draft with the calculator, and copy a past proposal into another project. Needs seed.cjs data.
const path = require('path');
const fs = require('fs');
const { launch, WEB } = require('./browser.cjs');
const { instrument, snapshot, since } = require('./effort.cjs');

const out = path.join(process.env.E2E_OUT ?? '/tmp/e2e-run', 'faster-proposal');
fs.mkdirSync(out, { recursive: true });
const ids = JSON.parse(fs.readFileSync(path.join(process.env.E2E_OUT ?? '/tmp/e2e-run', 'ids.json'), 'utf8'));
const ok = (m) => console.log('✓ ' + m);

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); instrument(p);
  await p.goto(WEB + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill('a very long password 1'); await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');

  await p.goto(`${WEB}/proposals/${ids.proposal}`);
  await p.getByRole('button', { name: 'Save as template' }).click();
  const d = p.locator('dialog[open]'); await d.getByLabel('Template name').fill('Billing portal package');
  await d.getByRole('button', { name: 'Save template' }).click(); await d.getByText(/Saved\. Choose/).waitFor(); await d.getByRole('button', { name: 'Done' }).click();
  ok('a past proposal is saved as a template');

  // From a lead to a priced proposal, starting from that template.
  await p.goto(WEB + '/engagements?new=1'); const ld = p.locator('dialog[open]');
  await ld.getByLabel('Client').selectOption({ label: 'Acme Retail' }); await ld.getByLabel('Title').fill('Brand site');
  await ld.getByRole('button', { name: 'Create lead' }).click(); await p.waitForURL(/engagements\/[0-9a-f-]{36}$/);
  const s = snapshot(); // counted from the lead page
  await p.getByRole('button', { name: 'Start project' }).click(); await p.waitForURL(/tab=proposals/);
  await p.getByRole('button', { name: 'New proposal' }).first().click();
  const nd = p.locator('dialog[open]'); await nd.getByLabel('Start from').selectOption({ label: 'Billing portal package' });
  await nd.getByRole('button', { name: 'Create proposal' }).click(); await p.waitForURL(/proposals\/[0-9a-f-]{36}$/);
  const effort = since(s);
  await p.getByLabel(/^Line \d+ description$/).first().waitFor({ timeout: 10000 }).catch(() => {});
  const lines = await p.getByLabel(/^Line \d+ description$/).count();
  if (lines < 1) throw new Error('the template should bring its pricing lines');
  await p.screenshot({ path: `${out}/01-from-template.png`, fullPage: true });
  ok(`lead to a priced draft from a template: ${effort.actions} actions (${lines} pricing lines already filled)`);

  // Re-price this draft with the calculator.
  await p.getByRole('link', { name: 'Re-price with the calculator' }).click(); await p.waitForURL(/estimator\?proposalId=/);
  await p.getByRole('button', { name: /Business website/ }).click();
  await p.getByLabel('How the client pays').selectOption('milestone');
  await p.getByRole('button', { name: /^Use in PROP/ }).click(); await p.waitForURL(/proposals\/[0-9a-f-]{36}$/);
  await p.getByLabel(/^Line \d+ description$/).first().waitFor();
  const descs = await p.getByLabel(/^Line \d+ description$/).evaluateAll((els) => els.map((e) => e.value));
  if (!descs.includes('Testing and fixes') || await p.getByLabel('Pricing model').inputValue() !== 'MILESTONE') throw new Error('calculator pricing not applied: ' + descs.join(' | '));
  await p.getByText('Percentages total 100%').waitFor();
  await p.screenshot({ path: `${out}/02-repriced.png`, fullPage: true });
  ok('the calculator re-prices the draft: its lines, milestone payment terms and pricing model replace the old ones, text kept');

  // Copy a past proposal into another project.
  await p.goto(`${WEB}/projects`); await p.getByText('Store locator').first().click(); await p.waitForURL(/projects\/[0-9a-f-]{36}/);
  await p.getByRole('tab', { name: 'Proposals' }).click(); await p.getByRole('button', { name: 'New proposal' }).first().click();
  const cd = p.locator('dialog[open]');
  const pastValue = await cd.getByLabel('Start from').locator('option').filter({ hasText: /Billing portal rebuild \(Northwind Labs\)/ }).first().getAttribute('value');
  await cd.getByLabel('Start from').selectOption(pastValue);
  if (await cd.getByLabel('Title').count()) throw new Error('a copy takes the project name; no title to type');
  await cd.getByRole('button', { name: 'Create proposal' }).click(); await p.waitForURL(/proposals\/[0-9a-f-]{36}$/);
  await p.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Store locator').waitFor();
  await p.getByLabel(/^Line \d+ description$/).first().waitFor({ timeout: 10000 }).catch(() => {});
  if ((await p.getByLabel(/^Line \d+ description$/).count()) < 1) throw new Error('the copy should keep its pricing');
  ok('a past proposal is copied into another project with its pricing, filed under that project');
  console.log('FASTER PROPOSAL OK');
  await b.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 4).join(' | ')); process.exit(1); });
