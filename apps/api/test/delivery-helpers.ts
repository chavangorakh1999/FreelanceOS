import { bearer, Harness } from './harness';

export const ITEMS = [
  { kind: 'DELIVERABLE', title: 'Billing portal', description: 'Customer-facing portal with invoices and payments.' },
  { kind: 'FEATURE', title: 'Payment gateway integration', description: 'Card and UPI payments.' },
  { kind: 'EXCLUSION', title: 'Mobile apps', description: 'Native apps are out of scope.' },
];

export function delivery(h: Harness, token: string) {
  const T = () => bearer(token);
  const post = (url: string, body?: object) => h.http().post(url).set(T()).send(body ?? {});
  const put = (url: string, body: object) => h.http().put(url).set(T()).send(body);
  const patch = (url: string, body: object) => h.http().patch(url).set(T()).send(body);
  const get = (url: string) => h.http().get(url).set(T());

  const makeClient = async (name = 'Northwind Labs') =>
    (await post('/clients', { type: 'COMPANY', name, primaryContact: { firstName: 'Priya', email: 'priya@northwind.test' } }).expect(201)).body.id as string;

  const makeProject = async (clientId: string, body: object = {}) =>
    (await post('/projects', { clientId, name: 'Billing portal rebuild', ...body }).expect(201)).body as { id: string; number: string };

  const decideScope = (pid: string, n: number, body: object = {}) =>
    post(`/projects/${pid}/scope/versions/${n}/decision`, { decision: 'APPROVED', channel: 'EMAIL', approverName: 'Priya Menon', ...body });

  /** Fill v1, submit it and record approval, so the project has a frozen baseline. */
  const approveBaseline = async (pid: string, items: object[] = ITEMS) => {
    await put(`/projects/${pid}/scope/versions/1`, { summary: 'Initial scope', items }).expect(200);
    await post(`/projects/${pid}/scope/versions/1/submit`).expect(200);
    await decideScope(pid, 1).expect(201);
  };

  const baselineProject = async (clientId?: string) => {
    const cid = clientId ?? (await makeClient());
    const p = await makeProject(cid);
    await approveBaseline(p.id);
    return { ...p, clientId: cid };
  };

  const assessment = (over: object = {}) => ({
    costDelta: '20000.00', currency: 'INR', timelineDeltaDays: 5, deliverablesImpact: 'Adds a refund workflow',
    dependenciesImpact: 'Needs the payment gateway first', risk: 'MEDIUM', requiresAddendum: true, ...over,
  });

  return { post, put, patch, get, makeClient, makeProject, decideScope, approveBaseline, baselineProject, assessment };
}
