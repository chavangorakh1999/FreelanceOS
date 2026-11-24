const { launch, WEB: SHARED_WEB } = require('./browser.cjs');
const WEB = SHARED_WEB;
const ids = require(process.argv[2] + '/ids.json');
(async () => {
  const b = await launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const ok = (s) => console.log('✓', s);
  await p.goto(WEB + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill('a very long password 1');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');
  // whole row opens the record: click the status/number cell, not the name
  for (const [list, cellText, expect] of [['/clients', 'rahul@acmeretail.test', /\/clients\/[0-9a-f-]{36}$/], ['/proposals', 'Accepted', /\/proposals\/[0-9a-f-]{36}$/], ['/projects', 'PRJ/', /\/projects\/[0-9a-f-]{36}$/], ['/finance?tab=invoices', 'Partially paid', /\/invoices\//], ['/finance?tab=payments', 'Bank transfer', /\/payments\//], ['/changes', 'Assessed', /\/change-requests\//], ['/agreements', 'Signed', /\/agreements\/[0-9a-f-]{36}$/]]) {
    await p.goto(WEB + '' + list); await p.locator('tbody tr').first().waitFor();
    await p.locator('tbody tr td').filter({ hasText: cellText }).first().click();
    await p.waitForURL(expect); ok(`row click on ${list} opens the record`);
  }
  // board card opens the lead; the lead becomes a project, and the proposal is written inside it without picking a client
  await p.goto(WEB + '/engagements'); await p.getByText('Blue Fern Studio').first().click({ force: true }); await p.waitForURL(/\/engagements\/[0-9a-f-]{36}$/); ok('board card opens the lead');
  const leadTitle = (await p.getByRole('heading', { level: 1 }).innerText()).trim();
  await p.getByRole('button', { name: 'Start project' }).click(); await p.waitForURL(/\/projects\/[0-9a-f-]{36}\?tab=proposals/);
  await p.getByRole('tab', { name: 'Proposals', selected: true }).waitFor(); ok('Start project opens the new project at its Proposals tab');
  await p.getByRole('button', { name: 'New proposal' }).first().click();
  const d = p.locator('dialog[open]'); if (await d.getByLabel('Title').inputValue() !== leadTitle) throw new Error('title should default to the project name');
  await d.getByRole('button', { name: 'Create proposal' }).click(); await p.waitForURL(/\/proposals\/[0-9a-f-]{36}$/);
  await p.getByRole('navigation', { name: 'Breadcrumb' }).getByText(leadTitle).waitFor();
  const pc = await p.getByRole('navigation', { name: 'Breadcrumb' }).innerText(); if (!pc.includes('Projects') || !pc.includes(leadTitle)) throw new Error('proposal crumbs: ' + pc);
  ok('the proposal is created inside the project (no client or project to pick) and its breadcrumb shows the project');
  if (await p.locator('nav[aria-label="Workspace"] >> text=Proposals').count()) throw new Error('Proposals should not be in the sidebar');
  ok('the sidebar keeps only leads, projects and clients for work');
  // Create menu
  await p.goto(WEB + '/dashboard'); await p.getByRole('button', { name: 'Create', exact: true }).click();
  const items = await p.getByRole('menuitem').allInnerTexts(); if (items.map((t) => t.split('\n')[0].trim()).join(',') !== 'Lead,Project,Client') throw new Error('Create menu: ' + items.join(' | '));
  await p.getByRole('menuitem', { name: /Project/ }).click();
  await p.waitForURL(/projects\?new=1/); await p.locator('dialog[open]').waitFor(); ok('Create menu offers Lead, Project and Client; Project opens the new-project dialog');
  // client hub tabs
  await p.goto(`${WEB}/clients/${ids.client}?tab=deals`); await p.getByRole('heading', { name: 'Proposals' }).waitFor(); await p.getByText('PROP/').first().waitFor();
  await p.getByRole('tab', { name: 'Projects' }).click(); await p.getByText('Billing portal rebuild').first().waitFor();
  await p.getByRole('tab', { name: 'Invoices & payments' }).click(); await p.getByText('INV/').first().waitFor(); ok('client hub tabs show proposals, agreements, projects, invoices and payments');
  // breadcrumb trail
  await p.goto(`${WEB}/change-requests/${ids.cr}`);
  await p.getByRole('navigation', { name: 'Breadcrumb' }).getByText('CR-001').waitFor();
  const crumbs = await p.getByRole('navigation', { name: 'Breadcrumb' }).innerText(); if (!/Projects[\s\S]*Billing portal rebuild[\s\S]*CR-001/.test(crumbs)) throw new Error('crumbs: ' + crumbs); ok('breadcrumbs show the full path to the current record');
  await b.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('NAV OK');
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
