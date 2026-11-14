// A real person's week, measured: share a project with a client contact who is not in the portal yet, plan five tasks with a
// dependency, hand one to the client, sign the agreement (owner draws, client uploads), and the client finishes their task.
// Every click, field, choice and page is counted (effort.cjs) and each screen is captured at desktop and phone width.
// Run on an empty database: E2E_OUT=/tmp/run E2E_DATABASE_URL=... node ops/e2e/real-user.cjs
const fs = require('fs');
const path = require('path');
const { launch, psql, WEB, API } = require('./browser.cjs');
const { instrument, snapshot, since } = require('./effort.cjs');

const PW = 'a very long password 1';
const TOKEN = 'real-user-invite-token-0123456789abcdef';
const out = process.env.E2E_OUT ?? '/tmp/e2e-run';
const shots = path.join(out, 'real-user');
fs.mkdirSync(shots, { recursive: true });
const SIG = path.join(__dirname, '../../apps/api/test/fixtures-signature.png');

(async () => {
  const tok = (await (await fetch(API + '/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Gorakh Chavan', email: 'owner@example.com', password: PW, workspaceName: 'Gorakh Studio' }) })).json()).accessToken;
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
  const c = await call('POST', '/clients', { type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@nw.test' } });
  const pr = await call('POST', '/projects', { clientId: c.id, name: 'Billing portal' });
  await call('POST', `/projects/${pr.id}/milestones`, { name: 'Design' });
  const ag = await call('POST', '/agreements', { clientId: c.id, title: 'Billing portal services' });
  const v1 = await call('GET', `/agreements/${ag.id}/versions/1`);
  await call('PUT', `/agreements/${ag.id}/versions/1`, {
    clauses: v1.clauses.length ? v1.clauses.map((x) => ({ heading: x.heading, body: x.body.replace(/\[[^\]]+\]/g, 'Agreed text.') })) : [{ heading: 'Services', body: 'Design and build of the billing portal.' }],
    signers: [{ role: 'FREELANCER', name: 'Gorakh Chavan', email: 'owner@example.com', signingOrder: 1 }, { role: 'CLIENT', name: 'Priya Menon', email: 'priya@nw.test', signingOrder: 2 }],
  });
  await call('POST', `/agreements/${ag.id}/versions/1/send`);

  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); instrument(p);
  const shot = (n) => p.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
  await p.goto(WEB + '/login'); await p.getByLabel('Email').fill('owner@example.com'); await p.getByLabel('Password').fill(PW); await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/dashboard');
  const r = {};

  // A. Let Priya, who is not in the portal yet, see the project: one button, the invitation goes with it.
  let s = snapshot();
  await p.goto(`${WEB}/projects/${pr.id}`);
  await p.getByRole('button', { name: 'Give Priya Menon access' }).click();
  await p.getByText(/Invitation sent to priya@nw.test/).waitFor();
  r.shareProjectWithNewClientContact = since(s);
  await shot('01-project-client-access');

  // B. Five tasks in the Design milestone, one waiting on another, all visible to the client (the project is shared).
  s = snapshot();
  await p.getByRole('tab', { name: 'Work' }).click();
  await p.getByLabel('Milestone', { exact: true }).selectOption({ label: 'Design' });
  await p.getByRole('region', { name: /^To do/ }).getByRole('button', { name: 'Add task' }).click();
  const input = p.getByRole('region', { name: /^To do/ }).getByLabel('New task title');
  for (const t of ['Wireframes', 'Visual design', 'Design review', 'Style guide', 'Handover']) {
    await input.fill(t); await input.press('Enter');
    await p.getByRole('button', { name: t, exact: true }).waitFor();
  }
  await p.getByRole('button', { name: 'Design review', exact: true }).click();
  await p.getByLabel('Add a task this waits for').selectOption({ label: 'T-2 Visual design' });
  await p.getByText('Visual design', { exact: true }).last().waitFor();
  r.fiveTasksWithMilestoneVisibilityAndOneDependency = since(s);
  await shot('02-task-drawer');

  // C. Hand "Style guide" to Priya.
  s = snapshot();
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Style guide', exact: true }).click();
  await p.getByLabel('Assignee').selectOption({ label: 'Priya Menon (not in the portal yet)' });
  await p.getByRole('dialog').getByText('Visible (assigned to the client)').waitFor();
  r.assignTaskToClient = since(s);
  await p.keyboard.press('Escape');
  await shot('03-board');

  // D. The owner signs the agreement by drawing.
  s = snapshot();
  await p.goto(`${WEB}/agreements/${ag.id}`);
  await p.getByRole('button', { name: 'Sign now' }).click();
  const d = p.locator('dialog[open]');
  await d.getByRole('radio', { name: 'Draw' }).click();
  const box = await d.getByLabel('Draw your signature here').boundingBox();
  await p.mouse.move(box.x + 30, box.y + 90); await p.mouse.down();
  for (let i = 0; i <= 40; i++) await p.mouse.move(box.x + 30 + i * 8, box.y + 80 + Math.sin(i / 3) * 25);
  await p.mouse.up();
  await d.getByText('I agree to be bound by this agreement.').click();
  await shot('04-owner-draws');
  await d.getByRole('button', { name: 'Sign', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  await p.getByRole('img', { name: 'Signature of Gorakh Chavan' }).waitFor();
  r.ownerSignsByDrawing = { ...since(s), strokes: 1 };
  await shot('05-agreement-owner-signed');

  // E. Priya accepts the invitation on her phone, finishes her task and signs with an uploaded image.
  psql(`UPDATE portal_invitations SET "tokenHash" = encode(sha256('${TOKEN}'::bytea), 'hex') WHERE "usedAt" IS NULL`);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const m = await phone.newPage(); instrument(m);
  const mshot = (n) => m.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
  s = snapshot();
  await m.goto(`${WEB}/portal/accept/${TOKEN}`);
  await m.getByLabel('Your full name').fill('Priya Menon'); await m.getByLabel('Choose a password').fill(PW);
  await m.getByRole('button', { name: 'Create account and continue' }).click(); await m.waitForURL('**/portal');
  await m.getByText('Waiting on you').first().waitFor();
  r.clientJoins = since(s);
  await mshot('06-portal-home');
  s = snapshot();
  await m.getByRole('link', { name: /Style guide/ }).click();
  await m.getByRole('heading', { name: /Waiting on you/ }).waitFor();
  await mshot('07-portal-project');
  await m.getByRole('button', { name: 'Mark done' }).first().click();
  await m.getByRole('heading', { name: /Waiting on you/ }).waitFor({ state: 'hidden' });
  r.clientCompletesTask = since(s);
  s = snapshot();
  await m.goto(`${WEB}/portal/agreements/${ag.id}`);
  await m.getByRole('radio', { name: 'Upload' }).click();
  await m.getByLabel('Signature image').setInputFiles(SIG);
  await m.getByText('I have read this agreement and agree to be bound by it.').click();
  await mshot('08-portal-sign-upload');
  await m.getByRole('button', { name: 'Sign agreement' }).click();
  await m.getByText('You signed this agreement.').waitFor();
  r.clientSignsByUpload = since(s);
  await mshot('09-portal-signed');

  // The owner sees the client's work: task done, both signatures on the agreement.
  await p.goto(`${WEB}/agreements/${ag.id}`);
  await p.getByRole('img', { name: 'Signature of Priya Menon' }).waitFor();
  await shot('10-agreement-both-signed');
  await p.goto(`${WEB}/projects/${pr.id}?tab=work`);
  await p.getByRole('region', { name: /^Done, 1/ }).getByText('Style guide').waitFor();
  const audit = psql(`SELECT count(*) FROM audit_events WHERE action IN ('project.client_access_updated','task.assigned','task.completed_by_client')`);
  if (Number(audit) < 3) throw new Error('expected audit events for sharing, assignment and client completion, got ' + audit);

  fs.writeFileSync(path.join(out, 'real-user-effort.json'), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
  console.log('real-user: all steps passed');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
