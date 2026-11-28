// Cashfree end to end: the owner connects their Cashfree keys in Settings; the client presses "Pay now" on a phone,
// goes through checkout and comes back; the invoice is paid, the payment recorded and applied, and the owner told.
// Cashfree itself is replaced by a local stand-in (same API contract) on :4999, and its checkout script by a stub.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { launch, psql, WEB, API } = require('./browser.cjs');

const out = path.join(process.env.E2E_OUT ?? '/tmp/e2e-run', 'cashfree');
fs.mkdirSync(out, { recursive: true });
const PW = 'a very long password 1';
const TOKEN = 'cashfree-invite-token-0123456789abcdefgh';
const APP_ID = 'TEST_APP_ID', SECRET = 'cfsk_test_secret_value_1234';
const ok = (m) => console.log('✓ ' + m);

const orders = new Map();
const fake = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
  const send = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(d)); };
  if (req.method === 'OPTIONS') return send(204, {});
  const url = req.url.replace(/^\/pg/, '');
  let m;
  if ((m = url.match(/^\/__checkout\/session_(.+)$/))) { // what the stub checkout calls: the client "pays"
    const o = orders.get(m[1]); o.order_status = 'PAID';
    o.payments = [{ cf_payment_id: 900001, payment_status: 'SUCCESS', payment_amount: o.order_amount, payment_group: 'upi', bank_reference: 'UTR123' }];
    return send(200, { return_url: o.order_meta.return_url.replace('{order_id}', o.order_id) });
  }
  if (req.headers['x-api-version'] !== '2023-08-01') return send(400, { message: 'bad version' });
  if (req.headers['x-client-id'] !== APP_ID || req.headers['x-client-secret'] !== SECRET) return send(401, { message: 'authentication Failed' });
  if (req.method === 'POST' && url === '/orders') { const o = { ...body, cf_order_id: 1, order_status: 'ACTIVE', payment_session_id: `session_${body.order_id}`, payments: [] }; orders.set(o.order_id, o); return send(200, o); }
  if ((m = url.match(/^\/orders\/([^/]+)\/payments$/))) { const o = orders.get(m[1]); return o ? send(200, o.payments) : send(404, { message: 'order not found' }); }
  if ((m = url.match(/^\/orders\/([^/]+)$/))) { const o = orders.get(m[1]); return o ? send(200, o) : send(404, { message: 'order not found' }); }
  send(404, {});
});
const STUB_SDK = `window.Cashfree = function () { return { checkout: async function (o) {
  const r = await fetch('http://127.0.0.1:4999/__checkout/' + o.paymentSessionId, { method: 'POST' });
  window.location.href = (await r.json()).return_url; } }; };`;

(async () => {
  await new Promise((r) => fake.listen(4999, '127.0.0.1', r));
  const setup = await (await fetch(API + '/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Gorakh Chavan', email: 'owner@example.com', password: PW, workspaceName: 'Gorakh Studio', defaultCurrency: 'INR' }) })).json();
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + setup.accessToken }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
  const c = await call('POST', '/clients', { type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@nw.test' } });
  await call('POST', `/clients/${c.id}/portal/invitations`, { contactId: (await call('GET', `/clients/${c.id}/portal`)).contacts[0].contactId, role: 'APPROVER' });
  psql(`UPDATE portal_invitations SET "tokenHash" = encode(sha256('${TOKEN}'::bytea), 'hex') WHERE "usedAt" IS NULL`);
  await fetch(API + '/portal/auth/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN, password: PW, name: 'Priya Menon' }) });
  const inv = await call('POST', '/invoices', { clientId: c.id, currency: 'INR', lines: [{ description: 'Billing portal, milestone 1', quantity: '1', unitRate: '25000', taxBps: 0 }] });
  const issued = await call('POST', `/invoices/${inv.id}/issue`, {});
  await call('POST', `/invoices/${inv.id}/share`);

  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(WEB + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill(PW); await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');
  await p.goto(WEB + '/settings'); await p.getByRole('heading', { name: 'Online payments with Cashfree' }).waitFor();
  await p.getByLabel('App ID').fill(APP_ID); await p.getByLabel('Secret Key').fill('wrong-secret-value');
  await p.getByRole('button', { name: 'Connect' }).click(); await p.getByText(/did not accept this App ID and Secret Key/).waitFor();
  await p.getByLabel('Secret Key').fill(SECRET); await p.getByRole('button', { name: 'Connect' }).click();
  await p.getByText('Cashfree accepted the keys').waitFor(); await p.getByText('Test mode').waitFor();
  await p.getByRole('heading', { name: 'Online payments with Cashfree' }).locator('xpath=ancestor::section[1]').screenshot({ path: `${out}/01-settings.png` });
  ok('wrong keys are refused before saving; the right keys connect in test mode');

  const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await phoneCtx.route('https://sdk.cashfree.com/js/v3/cashfree.js', (r) => r.fulfill({ contentType: 'application/javascript', body: STUB_SDK }));
  const phone = await phoneCtx.newPage();
  await phone.goto(WEB + '/portal/login'); await phone.getByLabel('Email').fill('priya@nw.test'); await phone.getByLabel('Password').fill(PW); await phone.getByRole('button', { name: 'Sign in' }).click(); await phone.waitForURL('**/portal');
  await phone.goto(`${WEB}/portal/invoices/${inv.id}`);
  await phone.getByRole('button', { name: 'Pay ₹25,000.00 now' }).waitFor();
  await phone.getByLabel('Mobile number for the receipt').fill('+91 98765 43210');
  if (await phone.getByRole('button', { name: 'I’ve paid this' }).count()) throw new Error('with only online payment, there is no manual "I\'ve paid"');
  await phone.screenshot({ path: `${out}/02-portal-pay-now.png`, fullPage: true });
  await phone.getByRole('button', { name: 'Pay ₹25,000.00 now' }).click();
  await phone.waitForURL(/cf_order=fos_/).catch(() => {});
  await phone.getByText('Payment received. Thank you.').waitFor();
  await phone.getByText('Paid', { exact: true }).first().waitFor();
  await phone.screenshot({ path: `${out}/03-portal-paid.png`, fullPage: true });
  const o = [...orders.values()][0];
  if (o.order_amount !== 25000 || o.customer_details.customer_phone !== '9876543210' || o.order_meta.return_url !== `${WEB}/portal/invoices/${inv.id}?cf_order={order_id}`) throw new Error('order sent to Cashfree: ' + JSON.stringify(o));
  ok('client pays from the phone through checkout, comes back, and sees the invoice paid');

  if (psql(`SELECT method || ' ' || "amountMinor" FROM payments`) !== 'UPI 2500000') throw new Error('payment not recorded as UPI 25000');
  if (psql(`SELECT status FROM invoices WHERE id = '${inv.id}'`) !== 'ISSUED') throw new Error('invoice stored status');
  const after = await call('GET', `/invoices/${inv.id}`);
  if (after.balance.outstanding.amountMinor !== '0' || after.status !== 'PAID') throw new Error('invoice should be paid: ' + JSON.stringify(after.balance));
  await p.goto(WEB + '/notifications'); await p.getByText(`Northwind Labs paid invoice ${issued.number} online`).waitFor();
  ok('the payment is recorded (UPI, Cashfree reference), applied to the invoice, and the owner is told');
  console.log('CASHFREE OK');
  await b.close(); fake.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 4).join(' | ')); fake.close(); process.exit(1); });
