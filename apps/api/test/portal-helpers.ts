import { delivery } from './delivery-helpers';
import { bearer, Harness } from './harness';

export const PORTAL_PASSWORD = 'a long portal password 1';

/** Owner-side setup + helpers to invite a contact and sign them in to the portal. */
export function portalKit(h: Harness, ownerToken: string) {
  const d = delivery(h, ownerToken);
  const O = () => bearer(ownerToken);

  const client = async (name = 'Northwind Labs', contact: { firstName?: string; lastName?: string; email?: string | null } = {}) => {
    const body = { type: 'COMPANY', name, primaryContact: { firstName: contact.firstName ?? 'Priya', lastName: contact.lastName ?? 'Menon', ...(contact.email === null ? {} : { email: contact.email ?? `priya@${name.toLowerCase().replace(/\W+/g, '')}.test` }) } };
    const c = (await h.http().post('/clients').set(O()).send(body).expect(201)).body as { id: string };
    const detail = (await h.http().get(`/clients/${c.id}`).set(O()).expect(200)).body;
    return { clientId: c.id, contactId: detail.contacts[0].id as string, email: detail.contacts[0].email as string | undefined };
  };

  const invite = (clientId: string, body: object) => h.http().post(`/clients/${clientId}/portal/invitations`).set(O()).send(body);

  /** The one-time token, read from the queued invitation email (the database only ever stores its hash). */
  const tokenFor = async (email: string) => {
    const row = await h.prisma.notificationDelivery.findFirstOrThrow({ where: { toEmail: email.toLowerCase(), category: 'INVITATION' }, orderBy: { createdAt: 'desc' } });
    return row.linkPath.split('/').pop()!;
  };

  const accept = (token: string, body: object = {}) => h.http().post('/portal/auth/accept').send({ token, password: PORTAL_PASSWORD, ...body });

  /** Invite + accept; returns the portal access token and cookie. */
  const onboard = async (c: { clientId: string; contactId: string; email?: string }, role: 'VIEWER' | 'APPROVER' = 'APPROVER', projectIds: string[] = []) => {
    await invite(c.clientId, { contactId: c.contactId, role, projectIds }).expect(201);
    const res = await accept(await tokenFor(c.email!)).expect(201);
    return { token: res.body.accessToken as string, cookie: (res.headers['set-cookie'] as unknown as string[])[0]!, user: res.body.user as { id: string; email: string } };
  };

  const P = (t: string) => bearer(t);
  const pget = (t: string, url: string) => h.http().get(url).set(P(t));
  const ppost = (t: string, url: string, body: object = {}) => h.http().post(url).set(P(t)).send(body);

  return { ...d, O, client, invite, tokenFor, accept, onboard, P, pget, ppost };
}
