// Hours to cash: the owner times work and types hours, bills them into an invoice in one click and shares it; the client
// opens it on a phone, sees a UPI QR and a payment link with the amount filled in, and says they paid; the owner hears.
const path = require('path');
const fs = require('fs');
const { launch, psql, WEB, API } = require('./browser.cjs');

const out = path.join(process.env.E2E_OUT ?? '/tmp/e2e-run', 'time-payments');
fs.mkdirSync(out, { recursive: true });
const PW = 'a very long password 1';
const TOKEN = 'time-payments-invite-token-0123456789abcd';
const ok = (m) => console.log('✓ ' + m);

(async () => {
  const setup = await (await fetch(API + '/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Gorakh Chavan', email: 'owner@example.com', password: PW, workspaceName: 'Gorakh Studio', defaultCurrency: 'INR' }) })).json();
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + setup.accessToken }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
  await call('PATCH', '/workspace/profile', { addressLine1: '12 MG Road', city: 'Pune', country: 'IN', upiId: 'gorakh@okhdfcbank', paymentLinkTemplate: 'https://pay.example.com/gorakh?amount={amount}&ref={invoice}', defaultTaxBps: 0 });
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(path.join(__dirname, '../../apps/api/test/fixtures-signature.png'))], { type: 'image/png' }), 'logo.png');
  const up = await fetch(API + '/workspace/profile/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + setup.accessToken }, body: fd });
  if (up.status !== 201) throw new Error('logo upload ' + up.status);
  const c = await call('POST', '/clients', { type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@nw.test' } });
  const pr = await call('POST', '/projects', { clientId: c.id, name: 'Billing portal' });
  await call('POST', `/projects/${pr.id}/tasks`, { title: 'Checkout page' });
  const access = await call('GET', `/projects/${pr.id}/client-access`);
  await call('PUT', `/projects/${pr.id}/client-access`, { people: [{ contactId: access.people[0].contactId, canSee: true }] });
  psql(`UPDATE portal_invitations SET "tokenHash" = encode(sha256('${TOKEN}'::bytea), 'hex') WHERE "usedAt" IS NULL`);
  await fetch(API + '/portal/auth/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN, password: PW, name: 'Priya Menon' }) });

  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(WEB + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill(PW); await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');
  await p.goto(`${WEB}/projects/${pr.id}?tab=time`);
  await p.getByLabel('What did you work on').fill('Checkout layout'); await p.getByLabel('Task').selectOption({ label: 'T-1 Checkout page' });
  await p.getByRole('button', { name: 'Start timer' }).click();
  await p.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Stop timer' }).waitFor(); // also in the header, on every page
  psql(`UPDATE time_entries SET "runningSince" = now() - interval '75 minutes' WHERE "runningSince" IS NOT NULL`);
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  await p.getByText('1:15').first().waitFor();
  await p.getByLabel('Duration').fill('1.5h'); await p.getByLabel('What did you work on').fill('Payment gateway');
  await p.getByRole('button', { name: /^Add 1:30/ }).click();
  await p.getByText('Payment gateway').waitFor();
  await p.screenshot({ path: `${out}/01-time-tab.png`, fullPage: true });
  ok('timer runs (and shows in the header), stops at 1:15; typed 1.5h adds 1:30');

  await p.getByRole('button', { name: /^Bill 2\.75 h/ }).click();
  const d = p.locator('dialog[open]'); await d.getByLabel('Hourly rate').fill('3500');
  await d.getByText('= 9,625 INR', { exact: false }).waitFor();
  await d.getByRole('button', { name: 'Create draft invoice' }).click(); await p.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  const invoiceId = p.url().split('/').pop();
  ok('2.75 unbilled hours become a draft invoice at ₹3,500/h in one dialog');
  const issued = await call('POST', `/invoices/${invoiceId}/issue`, {});
  const pdf = Buffer.from(await (await fetch(`${API}/invoices/${invoiceId}/pdf`, { headers: { Authorization: 'Bearer ' + setup.accessToken } })).arrayBuffer());
  if (pdf.subarray(0, 4).toString() !== '%PDF' || pdf.length < 5000) throw new Error('invoice PDF with the UPI QR did not render');
  await call('POST', `/invoices/${invoiceId}/share`);

  const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await phone.goto(WEB + '/portal/login'); await phone.getByLabel('Email').fill('priya@nw.test'); await phone.getByLabel('Password').fill(PW); await phone.getByRole('button', { name: 'Sign in' }).click(); await phone.waitForURL('**/portal');
  await phone.goto(`${WEB}/portal/invoices/${invoiceId}`);
  await phone.getByRole('img', { name: 'Gorakh Studio' }).first().waitFor(); // the freelancer's logo in the portal header
  await phone.getByRole('heading', { name: 'Pay ₹9,625.00' }).waitFor();
  await phone.getByRole('img', { name: 'UPI QR code', includeHidden: true }).waitFor({ state: 'attached' }); // shown from tablet width up; a phone opens the UPI app instead
  if (await phone.getByRole('img', { name: 'UPI QR code' }).isVisible()) throw new Error('a phone cannot scan its own screen: the QR should be hidden there');
  const upi = await phone.getByRole('link', { name: 'Pay with a UPI app' }).getAttribute('href');
  if (!upi.startsWith('upi://pay?pa=gorakh%40okhdfcbank') || !upi.includes('am=9625.00')) throw new Error('UPI link: ' + upi);
  const online = await phone.getByRole('link', { name: 'Pay online' }).getAttribute('href');
  if (online !== `https://pay.example.com/gorakh?amount=9625.00&ref=${encodeURIComponent(issued.number)}`) throw new Error('pay link: ' + online);
  await phone.screenshot({ path: `${out}/02-portal-pay.png`, fullPage: true });
  await phone.getByRole('button', { name: 'I’ve paid this' }).click(); await phone.getByLabel('Payment reference (optional)').fill('UTR 778899');
  await phone.getByRole('button', { name: 'Send' }).click(); await phone.getByText(/We’ve let them know/).waitFor();
  ok('the client sees a UPI QR and button and a payment link, amount filled in, and says they paid');

  await p.goto(WEB + '/notifications'); await p.getByText(/Priya Menon says invoice .* is paid/).waitFor(); await p.getByText('Reference: UTR 778899').waitFor();
  ok('the owner is told, with the reference');
  console.log('TIME AND PAYMENTS OK');
  await b.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join(' | ')); process.exit(1); });
