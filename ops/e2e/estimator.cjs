// Price calculator: your example (20 h + 10 h at $45 = $1,350), each discount type, two native apps, and a proposal that totals
// exactly what the calculator showed. Needs the seeded workspace (seed.cjs).
const { chromium } = require(require.resolve('playwright-core', { paths: [require('path').join(__dirname, '../../apps/api')] }));
const out = require('path').join(process.env.E2E_OUT ?? '/tmp/e2e-run', 'estimator'); require('fs').mkdirSync(out, { recursive: true }); const W = process.env.WEB_URL ?? 'http://localhost:3000';
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill('a very long password 1'); await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');
  await p.goto(W + '/estimator'); await p.getByRole('heading', { name: 'Price calculator' }).waitFor();
  await p.getByLabel('Currency', { exact: true }).selectOption('USD'); await p.getByLabel('Hourly rate').fill('45');
  // Your example: a plain website at 20 h, plus a payment gateway at 10 h, no overheads.
  for (const l of ['Testing', 'Management', 'Contingency']) await p.getByLabel(l, { exact: true }).fill('0');
  await p.getByText('Brochure website, up to 5 pages').click();
  await p.getByLabel('Brochure website, up to 5 pages, hours').fill('20');
  await p.getByText('Payment gateway, one-time payments').click();
  await p.getByLabel('Payment gateway, one-time payments, hours').fill('10');
  await p.locator('aside').getByText('$1,350.00', { exact: true }).last().waitFor(); console.log('✓ 20 h + 10 h at $45 is $1,350');
  await p.locator('aside').screenshot({ path: `${out}/01-your-example-30h-at-45.png` });
  // Template with research hours and defaults.
  for (const [l, v] of [['Testing', '20'], ['Management', '10'], ['Contingency', '15']]) await p.getByLabel(l, { exact: true }).fill(v);
  await p.getByRole('button', { name: /Online store/ }).click();
  await p.getByLabel('Discount', { exact: true }).selectOption('percent'); await p.getByLabel('Discount percent').fill('10');
  await p.waitForTimeout(300); await p.screenshot({ path: `${out}/02-online-store-template-10pct-off.png`, fullPage: true });
  await p.getByLabel('Discount', { exact: true }).selectOption('rate'); await p.getByLabel('Discounted hourly rate').fill('40');
  await p.waitForTimeout(200); await p.locator('aside').screenshot({ path: `${out}/03-lower-hourly-rate-40.png` });
  await p.getByRole('button', { name: /Mobile app/ }).first().click();
  await p.getByLabel('Mobile apps').selectOption('two-native');
  await p.waitForTimeout(200); await p.screenshot({ path: `${out}/04-mobile-app-two-native.png`, fullPage: true });
  const est = await p.locator('aside').getByText(/^\$[\d,]+\.\d\d$/).last().textContent();
  // Payment terms: each plan previews a schedule that adds up to the price; the milestone plan goes into the proposal.
  const plan = p.getByLabel('How the client pays');
  for (const k of ['monthly', 'hourly', 'deposit']) { await plan.selectOption(k); await p.getByRole('list', { name: 'Payment schedule' }).waitFor(); }
  await p.getByText(/Invoiced every month for hours worked/).first().waitFor({ state: 'detached' }).catch(() => {});
  await plan.selectOption('milestone');
  const schedule = await p.getByRole('list', { name: 'Payment schedule' }).locator('li').allTextContents();
  if (!/Deposit to start/.test(schedule[0] ?? '') || schedule.length < 3) throw new Error('milestone schedule missing: ' + schedule.join(' | '));
  await p.locator('aside').screenshot({ path: `${out}/05a-payment-terms-milestones.png` });
  console.log(`✓ milestone schedule: ${schedule.length} payments`);
  await p.getByRole('button', { name: 'Create proposal' }).click();
  const d = p.locator('dialog[open]'); await d.getByLabel('Client').selectOption({ index: 1 }); await d.getByLabel('Proposal title').fill('Delivery app');
  await p.screenshot({ path: `${out}/05-create-proposal.png` });
  await d.getByRole('button', { name: 'Create draft' }).click(); await p.waitForURL(/\/proposals\/[0-9a-f-]{36}/); await p.waitForLoadState('networkidle'); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/06-proposal-draft-from-estimate.png`, fullPage: true });
  const prop = await p.getByText('Total', { exact: true }).locator('xpath=following-sibling::*[1]').textContent();
  if (await p.getByLabel('Pricing model').inputValue() !== 'MILESTONE') throw new Error('the proposal should be milestone-priced');
  await p.getByText('Percentages total 100%').waitFor();
  const labels = await p.locator('input[id]').evaluateAll((els) => els.map((e) => e.value));
  for (const t of schedule.map((x) => x.split(',')[0].replace(/\$[\d,.]+.*$/, '').trim())) if (!labels.some((v) => v.startsWith(t.slice(0, 20)))) throw new Error('payment term not saved: ' + t);
  console.log('✓ the proposal saved the milestone payment terms (total 100%)');
  if (prop !== est) throw new Error(`proposal total ${prop} differs from the estimate ${est}`);
  console.log(`✓ the proposal totals exactly the estimate (${est})`);
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await m.goto(W + '/login'); await m.getByLabel('Email').fill('owner@example.com'); await m.getByLabel('Password').fill('a very long password 1'); await m.getByRole('button', { name: 'Sign in' }).click(); await m.waitForURL('**/dashboard');
  await m.goto(W + '/estimator'); await m.getByRole('button', { name: /Business website/ }).click(); await m.waitForTimeout(300);
  if (await m.evaluate(() => document.documentElement.scrollWidth) > 390) throw new Error('calculator scrolls sideways on a phone');
  await m.screenshot({ path: `${out}/07-phone.png`, fullPage: true }); await m.screenshot({ path: `${out}/08-phone-scrolled.png` });
  if (errs.length) throw new Error('page errors: ' + errs.join('; '));
  console.log('ESTIMATOR OK'); await b.close();
})().catch((e) => { console.error(e.message.slice(0, 400)); process.exit(1); });
