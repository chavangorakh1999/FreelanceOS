import { Inject, Injectable, Logger } from '@nestjs/common';
import { money, parseMoney, toDecimalString } from '@freelanceos/shared';
import { PaymentMethod } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { todayIn } from '../common/dates';
import { DomainError, notFound } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { InvoicesService } from '../finance/invoices.service';
import { PaymentsService } from '../finance/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { invoiceWhere } from '../portal/visibility';
import type { PortalContext } from '../portal/portal.guard';
import { PrismaService } from '../prisma/prisma.service';
import { cashfree, CfCreds, CfEnvironment, cashfreeSignatureValid } from './cashfree.client';
import { SecretBox } from './secrets';

const METHOD: Record<string, PaymentMethod> = { upi: 'UPI', card: 'CARD', credit_card: 'CARD', debit_card: 'CARD', net_banking: 'BANK_TRANSFER', netbanking: 'BANK_TRANSFER' };
/** Cashfree wants a 10-digit Indian mobile number; people type +91, spaces and dashes. */
export const normalisePhone = (s: string | null | undefined) => { const d = (s ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : null; };

/**
 * Online card / UPI / netbanking payments through the freelancer's own Cashfree account. An order is only treated as
 * paid when Cashfree's own Get Order and order payments say so, for the full amount; then the payment is recorded and
 * applied to the invoice exactly once (keyed by Cashfree's payment id). Webhooks and the client's return both just
 * trigger that check.
 */
@Injectable()
export class GatewayService {
  private readonly log = new Logger('Gateway');
  private readonly box: SecretBox;
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService,
    private readonly invoices: InvoicesService, private readonly payments: PaymentsService, @Inject(ENV) private readonly env: Env) {
    this.box = new SecretBox(env.secretsKey, env.jwtAccessSecret);
  }

  // ───────── owner settings ─────────

  async settings(a: AuthContext) {
    const g = await this.prisma.paymentGateway.findUnique({ where: { workspaceId: a.workspaceId } });
    return {
      provider: 'CASHFREE', connected: !!g, enabled: g?.enabled ?? false, environment: g?.environment ?? 'SANDBOX', clientId: g?.clientId ?? '', secretLast4: g?.secretLast4 ?? null,
      webhookUrl: `${this.env.apiPublicUrl}/webhooks/cashfree/${a.workspaceId}`, returnDomain: new URL(this.env.webOrigin).origin,
    };
  }

  async save(a: AuthContext, dto: { environment: CfEnvironment; clientId: string; clientSecret?: string; enabled: boolean }) {
    if (a.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Only the workspace owner can connect a payment gateway', 403);
    const current = await this.prisma.paymentGateway.findUnique({ where: { workspaceId: a.workspaceId } });
    const secret = dto.clientSecret?.trim() || (current ? this.box.open(current.secretEncrypted) : null);
    if (!secret) throw new DomainError('SECRET_REQUIRED', 'Enter the Secret Key from your Cashfree dashboard', 422);
    // Check the keys before saving them, so a typo is caught now rather than when a client tries to pay.
    if (!(await cashfree.check({ environment: dto.environment, clientId: dto.clientId.trim(), clientSecret: secret }))) throw new DomainError('GATEWAY_REJECTED', `Cashfree did not accept this App ID and Secret Key in ${dto.environment === 'SANDBOX' ? 'test' : 'live'} mode`, 422);
    const data = { environment: dto.environment, clientId: dto.clientId.trim(), secretEncrypted: this.box.seal(secret), secretLast4: secret.slice(-4), enabled: dto.enabled };
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentGateway.upsert({ where: { workspaceId: a.workspaceId }, create: { workspaceId: a.workspaceId, ...data }, update: data });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'gateway.connected', targetType: 'workspace', targetId: a.workspaceId, ip: a.ip, metadata: { provider: 'CASHFREE', environment: dto.environment, enabled: dto.enabled } });
    });
    return this.settings(a);
  }

  async disconnect(a: AuthContext) {
    if (a.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Only the workspace owner can disconnect a payment gateway', 403);
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentGateway.deleteMany({ where: { workspaceId: a.workspaceId } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'gateway.disconnected', targetType: 'workspace', targetId: a.workspaceId, ip: a.ip, metadata: { provider: 'CASHFREE' } });
    });
  }

  // ───────── client checkout ─────────

  /** What the portal offers for one invoice. */
  async portalOffer(workspaceId: string, currency: string, contactId: string) {
    const g = await this.prisma.paymentGateway.findUnique({ where: { workspaceId } });
    if (!g?.enabled || currency !== 'INR') return null;
    const contact = await this.prisma.clientContact.findUnique({ where: { id: contactId }, select: { phone: true } });
    return { provider: 'CASHFREE' as const, mode: g.environment === 'PRODUCTION' ? 'production' : 'sandbox', needsPhone: !normalisePhone(contact?.phone) };
  }

  async startCheckout(p: PortalContext, invoiceId: string, phoneInput?: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, ...invoiceWhere(p), status: 'ISSUED' }, select: { id: true, number: true, currency: true, client: { select: { name: true } } } });
    if (!inv) throw notFound('Invoice');
    const creds = await this.creds(p.workspaceId);
    if (inv.currency !== 'INR') throw new DomainError('CURRENCY_UNSUPPORTED', 'Online payment is available for invoices in INR', 422);
    const full = await this.invoices.get(this.ownerish(p.workspaceId, p.portalUserId), invoiceId);
    const outstanding = BigInt(full.balance.outstanding.amountMinor);
    if (outstanding <= 0n) throw new DomainError('NOTHING_OWED', 'This invoice is already paid', 409);
    const contact = await this.prisma.clientContact.findUnique({ where: { id: p.contactId }, select: { phone: true } });
    const phone = normalisePhone(phoneInput) ?? normalisePhone(contact?.phone);
    if (!phone) throw new DomainError('PHONE_REQUIRED', 'Enter a 10-digit mobile number for the payment receipt', 422);
    if (phoneInput && !contact?.phone) await this.prisma.clientContact.update({ where: { id: p.contactId }, data: { phone } }); // remembered for next time

    const orderId = `fos_${randomBytes(12).toString('hex')}`;
    const ret = `${this.env.webOrigin.replace(/\/$/, '')}/portal/invoices/${invoiceId}?cf_order={order_id}`;
    const notify = `${this.env.apiPublicUrl}/webhooks/cashfree/${p.workspaceId}`;
    const order = await cashfree.createOrder(creds, {
      order_id: orderId, order_amount: Number(toDecimalString(money(outstanding, 'INR'))), order_currency: 'INR', order_note: `Invoice ${inv.number}`.slice(0, 200),
      customer_details: { customer_id: p.portalUserId.replace(/-/g, ''), customer_phone: phone, customer_email: p.email, customer_name: p.name.slice(0, 100) },
      // Cashfree only calls https endpoints; on a local setup the client's return does the check instead.
      order_meta: { return_url: ret, ...(notify.startsWith('https://') ? { notify_url: notify } : {}) },
    });
    if (!order.payment_session_id) throw new DomainError('GATEWAY_ERROR', 'Cashfree did not open a payment session', 502);
    await this.prisma.gatewayOrder.create({ data: { workspaceId: p.workspaceId, invoiceId, environment: creds.environment, orderId, cfOrderId: order.cf_order_id ? String(order.cf_order_id) : null, amountMinor: outstanding, currency: 'INR', portalUserId: p.portalUserId } });
    await this.audit.record(this.prisma, { workspaceId: p.workspaceId, actorType: 'CLIENT_CONTACT', actorId: p.portalUserId, action: 'gateway.checkout_started', targetType: 'invoice', targetId: invoiceId, ip: p.ip, metadata: { orderId, amountMinor: outstanding.toString() } });
    return { orderId, paymentSessionId: order.payment_session_id, mode: creds.environment === 'PRODUCTION' ? 'production' : 'sandbox' };
  }

  /** After the client comes back from checkout. Only their own order on an invoice they can see. */
  async verifyForPortal(p: PortalContext, invoiceId: string, orderId: string) {
    const o = await this.prisma.gatewayOrder.findFirst({ where: { orderId, invoiceId, workspaceId: p.workspaceId, invoice: invoiceWhere(p) } });
    if (!o) throw notFound('Payment');
    return { status: await this.reconcile(o.orderId) };
  }

  /** Signed notification from Cashfree. Answers 200 to anything genuine, so Cashfree stops retrying. */
  async webhook(workspaceId: string, raw: Buffer, timestamp?: string, signature?: string) {
    const g = await this.prisma.paymentGateway.findUnique({ where: { workspaceId } });
    if (!g || !cashfreeSignatureValid(raw, timestamp, signature, this.box.open(g.secretEncrypted))) throw new DomainError('INVALID_SIGNATURE', 'Signature does not match', 401);
    let orderId: string | undefined;
    try { orderId = (JSON.parse(raw.toString('utf8')) as { data?: { order?: { order_id?: string } } }).data?.order?.order_id; } catch { /* not JSON: nothing to do */ }
    if (orderId && (await this.prisma.gatewayOrder.count({ where: { orderId, workspaceId } }))) await this.reconcile(orderId);
    return { received: true };
  }

  /**
   * Ask Cashfree what happened to an order and record the result. Idempotent: a second call (webhook after return, or
   * a retry) finds the payment already recorded.
   */
  async reconcile(orderId: string): Promise<'PAID' | 'ACTIVE' | 'EXPIRED' | 'FAILED'> {
    const o = await this.prisma.gatewayOrder.findUniqueOrThrow({ where: { orderId } });
    if (o.status === 'PAID') return 'PAID';
    const creds = await this.creds(o.workspaceId);
    const order = await cashfree.getOrder(creds, orderId);
    if (order.order_status === 'EXPIRED' || order.order_status === 'TERMINATED') {
      await this.prisma.gatewayOrder.update({ where: { id: o.id }, data: { status: 'EXPIRED' } });
      return 'EXPIRED';
    }
    if (order.order_status !== 'PAID') return 'ACTIVE';
    const paid = (await cashfree.getPayments(creds, orderId)).find((x) => x.payment_status === 'SUCCESS');
    if (!paid) return 'ACTIVE';
    const amount = parseMoney(Number(paid.payment_amount).toFixed(2), 'INR');
    if (amount.amountMinor !== o.amountMinor) {
      this.log.warn(`Cashfree order ${orderId}: paid ${amount.amountMinor} but expected ${o.amountMinor}; recording what was paid`);
    }
    const gatewayPaymentId = String(paid.cf_payment_id);
    const owner = await this.ownerContext(o.workspaceId);
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: o.workspaceId }, select: { timezone: true } });
    const inv = await this.invoices.get(owner, o.invoiceId);
    const outstanding = BigInt(inv.balance.outstanding.amountMinor);
    const apply = amount.amountMinor < outstanding ? amount.amountMinor : outstanding;
    const { payment, replayed } = await this.payments.create(owner, {
      clientId: inv.client.id, amount: toDecimalString(amount), currency: 'INR', receivedAt: todayIn(ws.timezone), method: METHOD[(paid.payment_group ?? '').toLowerCase()] ?? 'OTHER',
      reference: `Cashfree ${gatewayPaymentId}${paid.bank_reference ? `, bank ref ${paid.bank_reference}` : ''}`.slice(0, 200),
      note: `Paid online for invoice ${inv.number} (order ${orderId}).`,
      ...(apply > 0n ? { allocations: [{ invoiceId: o.invoiceId, amount: toDecimalString(money(apply, 'INR')) }] } : {}),
    }, `cashfree:${gatewayPaymentId}`);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.gatewayOrder.updateMany({ where: { id: o.id, status: { not: 'PAID' } }, data: { status: 'PAID', gatewayPaymentId, paymentId: payment.id } });
      if (claimed.count === 1 && !replayed) {
        await this.notify.emit(tx, { workspaceId: o.workspaceId, category: 'PAYMENT_NOTICE', title: `${inv.client.name} paid invoice ${inv.number} online`, body: `${toDecimalString(amount)} INR through Cashfree, recorded and applied.`, linkPath: `/invoices/${o.invoiceId}`, dedupeKey: `cashfree-paid:${gatewayPaymentId}`, to: await this.notify.staff(tx, o.workspaceId) });
      }
    });
    return 'PAID';
  }

  // ───────── internals ─────────

  private async creds(workspaceId: string): Promise<CfCreds> {
    const g = await this.prisma.paymentGateway.findUnique({ where: { workspaceId } });
    if (!g?.enabled) throw new DomainError('GATEWAY_OFF', 'Online payment is not set up for this business', 409);
    return { environment: g.environment, clientId: g.clientId, clientSecret: this.box.open(g.secretEncrypted) };
  }

  /** Payments made through the gateway are recorded in the owner's name (there is no signed-in staff user). */
  private async ownerContext(workspaceId: string): Promise<AuthContext> {
    const m = await this.prisma.workspaceMembership.findFirstOrThrow({ where: { workspaceId, role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
    return { userId: m.userId, workspaceId, role: 'OWNER', sessionId: 'gateway' };
  }

  private ownerish(workspaceId: string, portalUserId: string): AuthContext {
    return { userId: portalUserId, workspaceId, role: 'COLLABORATOR', sessionId: 'portal', portalUserId };
  }
}
