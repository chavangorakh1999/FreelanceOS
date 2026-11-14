const { launch, WEB: SHARED_WEB } = require('./browser.cjs');
const WEB = SHARED_WEB;
const out = process.argv[2] + '/phaseb'; require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const ok = (s) => console.log('✓', s);
  await p.goto(WEB + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill('a very long password 1');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');

  // ⌘K search: keyboard only (the page needs focus first, as it would for a person)
  await p.locator('main').click({ position: { x: 5, y: 5 } });
  await p.keyboard.press('Control+k');
  const box = p.getByRole('combobox', { name: 'Search everything' }); await box.waitFor(); await box.fill('northwind');
  await p.getByRole('option', { name: /Northwind Labs/ }).first().waitFor();
  await p.screenshot({ path: `${out}/search.png` });
  await p.keyboard.press('Enter'); await p.waitForURL(/\/clients\/[0-9a-f-]{36}$/); ok('Ctrl+K, type, Enter opens the client');
  await p.keyboard.press('Control+k'); await p.getByRole('combobox', { name: 'Search everything' }).fill('INV/26'); await p.getByRole('option').first().waitFor();
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForURL(/\/invoices\//); ok('arrow keys move through results; invoices are found by number');

  // collapsible sidebar, remembered across reloads
  await p.getByRole('button', { name: 'Collapse sidebar' }).click();
  const w = await p.locator('#primary-nav').evaluate((n) => n.getBoundingClientRect().width); if (w > 80) throw new Error('not collapsed: ' + w);
  await p.reload(); await p.getByRole('button', { name: 'Expand sidebar' }).waitFor(); ok('sidebar collapses to an icon rail and stays collapsed after reload');
  await p.getByRole('link', { name: 'Projects' }).click(); await p.waitForURL('**/projects'); ok('icon rail links still navigate');
  await p.screenshot({ path: `${out}/collapsed.png` });
  await p.getByRole('button', { name: 'Expand sidebar' }).click();

  // quick look: opens a side panel without leaving the list; the row itself still opens the page
  await p.goto(WEB + '/finance?tab=invoices'); await p.locator('tbody tr').first().waitFor();
  await p.getByRole('button', { name: /Quick look: INV\/26-27\/0002/ }).click();
  const drawer = p.getByRole('dialog', { name: 'INV/26-27/0002' }); await drawer.getByText('Outstanding').waitFor();
  if (!p.url().includes('/finance')) throw new Error('quick look navigated away');
  await p.screenshot({ path: `${out}/quicklook.png` });
  await p.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' }); ok('invoice quick look opens in place and closes with Escape');
  await p.goto(WEB + '/clients'); await p.getByRole('button', { name: /Quick look: Acme Retail/ }).click();
  await p.getByRole('dialog', { name: 'Acme Retail' }).getByText('Rahul Shah').waitFor(); await p.getByRole('dialog', { name: 'Acme Retail' }).getByRole('link', { name: 'Open client' }).click();
  await p.waitForURL(/\/clients\/[0-9a-f-]{36}$/); ok('client quick look shows contacts and opens the full page');

  // dashboard period
  await p.goto(WEB + '/dashboard'); await p.getByText('Cash received').waitFor();
  const cash = () => p.locator('dl div').filter({ hasText: 'Cash received' }).locator('dd').innerText();
  const before = await cash(); await p.getByLabel('Period for invoiced and cash received').selectOption('d30');
  await p.locator('dl div').filter({ hasText: 'Cash received' }).getByText('Last 30 days').waitFor();
  if ((await cash()) !== before) throw new Error('cash should match: received today');
  ok('dashboard period changes the money ledger labels and figures');

  await b.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('PHASE B OK');
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
