import { Injectable } from '@nestjs/common';
import { formatMoney, hasPlaceholder, money } from '@freelanceos/shared';
import { AgreementStatus, Prisma, SignatureKind } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { FILE_STORAGE, FileStorage } from '../library/storage';
import { sniff } from '../library/file-type';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { skipTake } from '../common/pagination';
import { renderAgreementHtml } from '../documents/html';
import { PdfService } from '../documents/pdf.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NumberSequenceService } from '../sequences/number-sequence.service';
import { TemplatesService } from '../templates/templates.service';
import { CreateAgreementDto, ListAgreementsQuery, RecordEventDto, SaveAgreementVersionDto, SignatureInput, SignInAppDto, VoidDto } from './agreements.dto';

type Tx = Prisma.TransactionClient;
const FULL = { clauses: { orderBy: { position: 'asc' } }, signers: { orderBy: [{ signingOrder: 'asc' }, { name: 'asc' }] }, events: { orderBy: { occurredAt: 'asc' }, omit: { signatureStorageKey: true } } } satisfies Prisma.AgreementVersionInclude;
type FullVersion = Prisma.AgreementVersionGetPayload<{ include: typeof FULL }>;

const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const OPEN: AgreementStatus[] = ['SENT', 'VIEWED', 'PARTIALLY_SIGNED'];
/** Expiry is derived, not stored: an unsigned agreement past its date reads as EXPIRED. */
const effectiveStatus = (status: AgreementStatus, expiresAt: Date | null): AgreementStatus => (OPEN.includes(status) && expiresAt && expiresAt < todayUtc() ? 'EXPIRED' : status);

/** SHA-256 over the canonical content, fixed when the version is sent (tamper evidence). */
export function contentHash(number: string, proposalVersionId: string | null, clauses: { heading: string; body: string }[], signers: { role: string; name: string; email: string; signingOrder: number }[]): string {
  const canonical = JSON.stringify({
    number, proposalVersionId,
    clauses: clauses.map((c) => [c.heading, c.body]),
    signers: [...signers].sort((x, y) => x.signingOrder - y.signingOrder || x.email.localeCompare(y.email)).map((s) => [s.role, s.name, s.email.toLowerCase(), s.signingOrder]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly seq: NumberSequenceService,
    private readonly templates: TemplatesService,
    private readonly pdf: PdfService,
    private readonly notify: NotificationsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // ───────── reads ─────────

  async list(a: AuthContext, q: ListAgreementsQuery) {
    const where: Prisma.AgreementWhereInput = {
      workspaceId: a.workspaceId, archivedAt: null,
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.agreement.count({ where }),
      this.prisma.agreement.findMany({ where, orderBy: { updatedAt: 'desc' }, ...skipTake(q), include: { client: { select: { id: true, name: true } }, proposal: { select: { id: true, number: true } } } }),
    ]);
    return { items: rows.map((r) => ({ ...r, status: effectiveStatus(r.status, r.expiresAt) })), page: q.page, pageSize: q.pageSize, total };
  }

  async get(a: AuthContext, id: string) {
    const ag = await this.prisma.agreement.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        client: { select: { id: true, name: true } },
        proposal: { select: { id: true, number: true, title: true } },
        versions: { orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, status: true, sentAt: true, signedAt: true, contentHash: true } },
      },
    });
    if (!ag) throw notFound('Agreement');
    return { ...ag, status: effectiveStatus(ag.status, ag.expiresAt) };
  }

  async getVersion(a: AuthContext, id: string, n: number) {
    return this.loadVersion(this.prisma, a, id, n); // storage keys are omitted at the query, never returned
  }

  // ───────── create / edit ─────────

  create(a: AuthContext, dto: CreateAgreementDto) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: dto.clientId, workspaceId: a.workspaceId }, include: { contacts: { where: { isPrimary: true, archivedAt: null }, take: 1 } } });
      if (!client) throw notFound('Client');
      if (client.status === 'ARCHIVED') throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before creating an agreement', 409);

      let proposal: { id: string; number: string; title: string; engagementId: string | null; acceptedVersionId: string | null; total?: string } | null = null;
      if (dto.proposalId) {
        const p = await tx.proposal.findFirst({ where: { id: dto.proposalId, workspaceId: a.workspaceId, clientId: client.id }, include: { acceptedVersion: true } });
        if (!p) throw notFound('Proposal');
        if (p.status !== 'ACCEPTED' || !p.acceptedVersion) throw new DomainError('PROPOSAL_NOT_ACCEPTED', 'Only an accepted proposal can be turned into an agreement', 409);
        proposal = { id: p.id, number: p.number, title: p.title, engagementId: p.engagementId, acceptedVersionId: p.acceptedVersionId, total: formatMoney(money(p.acceptedVersion.totalMinor, p.acceptedVersion.currency)) };
      }
      const tpl = await this.templates.find(tx, a.workspaceId, 'AGREEMENT', dto.templateId);
      if (dto.templateId && !tpl) throw notFound('Template');
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { name: true } });
      const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { name: true, email: true } });

      const vars: Record<string, string> = {
        'client.name': client.name, 'freelancer.name': ws.name, 'effective.date': new Date().toISOString().slice(0, 10),
        'proposal.number': proposal?.number ?? '[PROPOSAL REFERENCE]', 'proposal.total': proposal?.total ?? '[TOTAL]',
      };
      const subst = (t: string) => t.replace(/\{\{([\w.]+)\}\}/g, (m, k: string) => vars[k] ?? m);
      const clauses = ((tpl?.body as { clauses?: { heading: string; body: string }[] } | null)?.clauses ?? []);

      const number = await this.seq.nextDocumentNumber(tx, a.workspaceId, 'AGREEMENT', 'AGR');
      const contact = client.contacts[0];
      const agreement = await tx.agreement.create({
        data: {
          workspaceId: a.workspaceId, clientId: client.id, engagementId: dto.engagementId ?? proposal?.engagementId ?? null,
          proposalId: proposal?.id, proposalVersionId: proposal?.acceptedVersionId, templateId: tpl?.id, number,
          title: dto.title ?? (proposal ? `Services agreement: ${proposal.title}` : `Services agreement: ${client.name}`),
          expiresAt: dto.expiresAt, createdById: a.userId,
          versions: {
            create: {
              workspaceId: a.workspaceId, versionNumber: 1, createdById: a.userId,
              clauses: { create: clauses.map((c, i) => ({ workspaceId: a.workspaceId, position: i, heading: c.heading, body: subst(c.body) })) },
              signers: {
                create: [
                  { workspaceId: a.workspaceId, role: 'FREELANCER' as const, name: me.name, email: me.email, signingOrder: 1 },
                  ...(contact?.email ? [{ workspaceId: a.workspaceId, role: 'CLIENT' as const, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), email: contact.email, contactId: contact.id, signingOrder: 2 }] : []),
                ],
              },
            },
          },
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'agreement.created', targetType: 'agreement', targetId: agreement.id, objectVersion: 1, ip: a.ip, metadata: { number, proposalId: proposal?.id ?? null } });
      return agreement;
    });
  }

  saveVersion(a: AuthContext, id: string, n: number, dto: SaveAgreementVersionDto) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.loadVersion(tx, a, id, n);
      if (v.status !== 'DRAFT') throw new DomainError('VERSION_LOCKED', 'This version has been sent and can no longer be edited. Changes after signing are made through an amendment.', 409);
      const emails = dto.signers.map((s) => s.email.toLowerCase());
      if (new Set(emails.map((e, i) => `${e}|${dto.signers[i]!.role}`)).size !== emails.length) throw new DomainError('DUPLICATE_SIGNER', 'The same person is listed twice in the same role', 422);

      await tx.agreementClause.deleteMany({ where: { versionId: v.id } });
      await tx.agreementSigner.deleteMany({ where: { versionId: v.id } });
      await tx.agreementClause.createMany({ data: dto.clauses.map((c, i) => ({ workspaceId: a.workspaceId, versionId: v.id, position: i, heading: c.heading, body: c.body })) });
      await tx.agreementSigner.createMany({ data: dto.signers.map((s) => ({ workspaceId: a.workspaceId, versionId: v.id, role: s.role, name: s.name, email: s.email, contactId: s.contactId, signingOrder: s.signingOrder })) });
      await tx.agreement.update({ where: { id }, data: { ...(dto.title ? { title: dto.title } : {}), ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt } : {}) } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'agreement.version_saved', targetType: 'agreement', targetId: id, objectVersion: n, ip: a.ip });
      return this.loadVersion(tx, a, id, n);
    });
  }

  // ───────── lifecycle ─────────

  /** Lock the content and record its fingerprint. After this the clauses and signer list cannot change. */
  send(a: AuthContext, id: string, n: number) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.loadVersion(tx, a, id, n);
      const ag = await tx.agreement.findUniqueOrThrow({ where: { id } });
      if (v.status !== 'DRAFT') throw new DomainError('VERSION_LOCKED', 'This version has already been sent', 409);
      const problems: string[] = [];
      if (v.clauses.length === 0) problems.push('Add at least one clause');
      if (!v.signers.some((s) => s.role === 'FREELANCER')) problems.push('Add yourself as a signer');
      if (!v.signers.some((s) => s.role === 'CLIENT')) problems.push('Add at least one client signer');
      if (ag.expiresAt && ag.expiresAt < todayUtc()) problems.push('The expiry date is in the past');
      const unfinished = v.clauses.filter((c) => hasPlaceholder(c.body)).map((c) => c.heading);
      if (unfinished.length) problems.push(`Replace the bracketed placeholders before sending, in: ${unfinished.join(', ')}`);
      if (problems.length) throw new DomainError('NOT_READY_TO_SEND', 'This agreement is not ready to send', 422, problems);

      const hash = contentHash(ag.number, ag.proposalVersionId, v.clauses, v.signers);
      await tx.agreementVersion.update({ where: { id: v.id }, data: { status: 'SENT', sentAt: new Date(), contentHash: hash } });
      await tx.agreement.update({ where: { id }, data: { status: 'SENT' } });
      await tx.signatureEvent.create({ data: { workspaceId: a.workspaceId, versionId: v.id, type: 'SENT', method: 'MANUAL_RECORDED', occurredAt: new Date(), recordedById: a.userId, evidence: 'Marked as sent by the owner' } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'agreement.sent', targetType: 'agreement', targetId: id, objectVersion: n, ip: a.ip, metadata: { contentHash: hash } });
      await this.notify.emit(tx, {
        workspaceId: a.workspaceId, category: 'AGREEMENT_SENT', title: 'An agreement is ready to sign', body: `${ag.title} (${ag.number})`,
        linkPath: `/portal/agreements/${id}`, dedupeKey: `agreement-sent:${v.id}`, to: await this.notify.clientPeople(tx, a.workspaceId, ag.clientId, { approversOnly: true }),
      });
      return this.loadVersion(tx, a, id, n);
    });
  }

  /**
   * Record a signing event. Retries are safe: the same Idempotency-Key returns the first result and changes nothing.
   * The version row is locked first so two simultaneous signatures cannot both think they were last.
   */
  recordEvent(a: AuthContext, id: string, n: number, dto: RecordEventDto, idempotencyKey?: string, sig?: { kind: SignatureKind; storageKey?: string; sha256?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const v0 = await this.loadVersion(tx, a, id, n);
      await tx.$queryRaw`SELECT "id" FROM "agreement_versions" WHERE "id" = ${v0.id}::uuid FOR UPDATE`;

      if (idempotencyKey) {
        const prior = await tx.signatureEvent.findUnique({ where: { versionId_idempotencyKey: { versionId: v0.id, idempotencyKey } } });
        if (prior) return { replayed: true, version: await this.loadVersion(tx, a, id, n) };
      }
      const v = await this.loadVersion(tx, a, id, n);
      const ag = await tx.agreement.findUniqueOrThrow({ where: { id } });
      if (v.status !== 'SENT') throw new DomainError('VERSION_NOT_OPEN', `This version is ${v.status.toLowerCase()}; signing events can only be recorded while it is awaiting signatures.`, 409);
      if (ag.expiresAt && ag.expiresAt < todayUtc()) throw new DomainError('AGREEMENT_EXPIRED', 'This agreement has expired', 409);
      const occurredAt = dto.occurredAt ?? new Date();
      if (occurredAt.getTime() > Date.now() + 60_000) throw new DomainError('INVALID_DATE', 'An event cannot be dated in the future', 422);
      const method = dto.method ?? 'MANUAL_RECORDED';
      const base = {
        workspaceId: a.workspaceId, versionId: v.id, occurredAt, method, recordedById: a.portalUserId ? null : a.userId, idempotencyKey: idempotencyKey ?? null,
        portalUserId: a.portalUserId ?? null, ipAddress: a.portalUserId ? a.ip ?? null : null, userAgent: a.portalUserId ? a.userAgent ?? null : null,
      };
      const actor = { actorId: a.userId, actorType: a.portalUserId ? ('CLIENT_CONTACT' as const) : ('USER' as const) };

      if (dto.type === 'VIEWED') {
        await tx.signatureEvent.create({ data: { ...base, type: 'VIEWED', signerId: dto.signerId, evidence: dto.evidence } });
        if (ag.status === 'SENT') await tx.agreement.update({ where: { id }, data: { status: 'VIEWED' } });
      } else {
        const signer = v.signers.find((s) => s.id === dto.signerId);
        if (!signer) throw new DomainError('SIGNER_REQUIRED', 'Choose which signer this is for', 422);
        if (signer.status !== 'PENDING') throw new DomainError('ALREADY_RESOLVED', `${signer.name} has already ${signer.status === 'SIGNED' ? 'signed' : 'declined'}`, 409);

        if (dto.type === 'SIGNED') {
          if (method === 'MANUAL_RECORDED' && (dto.evidence?.trim().length ?? 0) < 3) {
            throw new DomainError('EVIDENCE_REQUIRED', 'Say how you know this was signed (e.g. "Signed PDF received by email on 12 Nov")', 422);
          }
          const blocking = v.signers.find((s) => s.signingOrder < signer.signingOrder && s.status !== 'SIGNED');
          if (blocking) throw new DomainError('OUT_OF_ORDER', `${blocking.name} must sign before ${signer.name}`, 409);

          await tx.agreementSigner.update({ where: { id: signer.id }, data: { status: 'SIGNED', signedAt: occurredAt } });
          await tx.signatureEvent.create({ data: { ...base, type: 'SIGNED', signerId: signer.id, evidence: dto.evidence, ...(sig ? { signatureKind: sig.kind, signatureStorageKey: sig.storageKey ?? null, signatureSha256: sig.sha256 ?? null } : {}) } });
          const allSigned = v.signers.every((s) => s.id === signer.id || s.status === 'SIGNED');
          if (allSigned) {
            await tx.agreementVersion.update({ where: { id: v.id }, data: { status: 'SIGNED', signedAt: occurredAt } });
            await tx.agreement.update({ where: { id }, data: { status: 'SIGNED' } });
          } else {
            await tx.agreement.update({ where: { id }, data: { status: 'PARTIALLY_SIGNED' } });
          }
          await this.audit.record(tx, { workspaceId: a.workspaceId, ...actor, action: allSigned ? 'agreement.signed' : 'agreement.signer_signed', targetType: 'agreement', targetId: id, objectVersion: n, ip: a.ip, metadata: { signer: signer.email, method, contentHash: v.contentHash } });
          if (a.portalUserId) {
            await this.notify.emit(tx, { workspaceId: a.workspaceId, category: 'AGREEMENT_SIGNED', title: `${signer.name} signed ${ag.number}`, body: ag.title, linkPath: `/agreements/${id}`, dedupeKey: `agreement-signed:${signer.id}`, to: await this.notify.staff(tx, a.workspaceId) });
          }
        } else {
          await tx.agreementSigner.update({ where: { id: signer.id }, data: { status: 'DECLINED', declinedAt: occurredAt, declineReason: dto.evidence } });
          await tx.signatureEvent.create({ data: { ...base, type: 'DECLINED', signerId: signer.id, evidence: dto.evidence } });
          await tx.agreementVersion.update({ where: { id: v.id }, data: { status: 'DECLINED' } });
          await tx.agreement.update({ where: { id }, data: { status: 'DECLINED' } });
          await this.audit.record(tx, { workspaceId: a.workspaceId, ...actor, action: 'agreement.declined', targetType: 'agreement', targetId: id, objectVersion: n, ip: a.ip, metadata: { signer: signer.email } });
          if (a.portalUserId) {
            await this.notify.emit(tx, { workspaceId: a.workspaceId, category: 'AGREEMENT_SIGNED', title: `${signer.name} declined ${ag.number}`, body: ag.title, linkPath: `/agreements/${id}`, dedupeKey: `agreement-declined:${signer.id}`, to: await this.notify.staff(tx, a.workspaceId) });
          }
        }
      }
      return { replayed: false, version: await this.loadVersion(tx, a, id, n) };
    });
  }

  // ───────── signatures made by their own signer ─────────

  /**
   * Check and keep a drawn or uploaded signature image. Only PNG or JPEG, decided from the bytes; small; stored privately
   * under a random key with its SHA-256, so the image on file can be proven to be the one given at signing.
   */
  async storeSignature(workspaceId: string, sig: SignatureInput): Promise<{ kind: SignatureKind; storageKey?: string; sha256?: string }> {
    if (sig.kind === 'TYPED') return { kind: 'TYPED' };
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(sig.image ?? '');
    if (!m) throw new DomainError('SIGNATURE_IMAGE_REQUIRED', sig.kind === 'DRAWN' ? 'Draw your signature first' : 'Choose an image of your signature (PNG or JPEG)', 422);
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length < 100) throw new DomainError('SIGNATURE_EMPTY', 'The signature is empty. Draw or upload it again.', 422);
    if (bytes.length > 500_000) throw new DomainError('SIGNATURE_TOO_LARGE', 'Use a signature image under 500 KB', 413);
    const kind = sniff(bytes, `signature.${m[1] === 'png' ? 'png' : 'jpg'}`);
    if (!kind || (kind.mimeType !== 'image/png' && kind.mimeType !== 'image/jpeg')) throw new DomainError('SIGNATURE_IMAGE_INVALID', 'The signature must be a PNG or JPEG image', 415);
    const storageKey = `${workspaceId}/signatures/${randomUUID()}`;
    await this.storage.put(storageKey, bytes);
    return { kind: sig.kind, storageKey, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  /** The owner signs as themselves, inside the app: only for a freelancer signer whose email is their own. */
  async signInApp(a: AuthContext, id: string, n: number, dto: SignInAppDto) {
    const v = await this.loadVersion(this.prisma, a, id, n);
    const signer = v.signers.find((s) => s.id === dto.signerId);
    if (!signer) throw new DomainError('SIGNER_REQUIRED', 'Choose which signer this is for', 422);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: a.userId }, select: { email: true } });
    if (signer.role !== 'FREELANCER' || signer.email.toLowerCase() !== me.email.toLowerCase()) throw new DomainError('NOT_YOUR_SIGNATURE', 'You can sign only as yourself. Record other people’s signatures as evidence instead.', 403);
    const norm = (x: string) => x.trim().replace(/\s+/g, ' ').toLowerCase();
    if (norm(dto.typedName) !== norm(signer.name)) throw new DomainError('NAME_MISMATCH', `Type your full name exactly as it appears: “${signer.name}”.`, 422);
    const stored = await this.storeSignature(a.workspaceId, dto.signature);
    return this.recordEvent(a, id, n, { type: 'SIGNED', signerId: signer.id, method: 'IN_APP', evidence: `Signed in the app (${stored.kind.toLowerCase()}) as “${dto.typedName.trim()}”, agreeing to the terms (content ${v.contentHash?.slice(0, 12) ?? 'n/a'}…).` }, `in-app:sign:${signer.id}`, stored);
  }

  /** The image of one signature, for the agreement page and PDF. Never served from a public path. */
  async signatureImage(a: AuthContext, id: string, eventId: string) {
    const e = await this.prisma.signatureEvent.findFirst({ where: { id: eventId, workspaceId: a.workspaceId, version: { agreementId: id }, signatureStorageKey: { not: null } } });
    if (!e) throw notFound('Signature');
    const bytes = await this.storage.get(e.signatureStorageKey!);
    return { bytes, fileName: bytes[0] === 0x89 ? 'signature.png' : 'signature.jpg', mimeType: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg' };
  }

  /** Signers with how they signed, ready for a PDF: drawn or uploaded images inline as data URLs, typed names as text. */
  async signatureMarks(versionId: string) {
    const events = await this.prisma.signatureEvent.findMany({ where: { versionId, type: 'SIGNED' }, select: { signerId: true, signatureKind: true, signatureStorageKey: true, evidence: true } });
    const out = new Map<string, { image?: string; typed?: string }>();
    for (const e of events) {
      if (!e.signerId) continue;
      if (e.signatureStorageKey) {
        const b = await this.storage.get(e.signatureStorageKey);
        out.set(e.signerId, { image: `data:${b[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${b.toString('base64')}` });
      } else if (e.signatureKind === 'TYPED') {
        out.set(e.signerId, { typed: /“([^”]+)”/.exec(e.evidence ?? '')?.[1] });
      }
    }
    return out;
  }

  /** A signed agreement cannot be voided here: it is changed only by an amendment (PRD §7.6). */
  void(a: AuthContext, id: string, dto: VoidDto) {
    return this.prisma.$transaction(async (tx) => {
      const ag = await tx.agreement.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } });
      if (!ag) throw notFound('Agreement');
      if (ag.status === 'SIGNED') throw new DomainError('AGREEMENT_SIGNED', 'A signed agreement cannot be voided. Use an amendment to change or end it.', 409);
      if (ag.status === 'VOIDED') throw new DomainError('ALREADY_VOID', 'This agreement is already void', 409);
      const v = ag.versions[0]!;
      if (v.status === 'DRAFT' || v.status === 'SENT') {
        await tx.agreementVersion.update({ where: { id: v.id }, data: { status: 'VOID' } });
        await tx.signatureEvent.create({ data: { workspaceId: a.workspaceId, versionId: v.id, type: 'VOIDED', method: 'MANUAL_RECORDED', occurredAt: new Date(), recordedById: a.userId, evidence: dto.reason } });
      }
      await tx.agreement.update({ where: { id }, data: { status: 'VOIDED', voidReason: dto.reason } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'agreement.voided', targetType: 'agreement', targetId: id, ip: a.ip, metadata: { reason: dto.reason } });
    });
  }

  async pdfFor(a: AuthContext, id: string, n: number): Promise<{ filename: string; buffer: Buffer }> {
    const ag = await this.prisma.agreement.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { client: { select: { name: true } }, workspace: { select: { name: true } } } });
    if (!ag) throw notFound('Agreement');
    const v = await this.loadVersion(this.prisma, a, id, n);
    const marks = await this.signatureMarks(v.id);
    const html = renderAgreementHtml({
      number: ag.number, title: ag.title, versionNumber: v.versionNumber, status: v.status, workspaceName: ag.workspace.name, clientName: ag.client.name,
      contentHash: v.contentHash, sentAt: v.sentAt?.toISOString() ?? null, clauses: v.clauses,
      signers: v.signers.map((s) => ({ role: s.role, name: s.name, email: s.email, status: s.status, signedAt: s.signedAt?.toISOString().slice(0, 10) ?? null, signatureImage: marks.get(s.id)?.image ?? null, typedSignature: marks.get(s.id)?.typed ?? null })),
    });
    return { filename: `${ag.number.replaceAll('/', '-')}-v${n}.pdf`, buffer: await this.pdf.render(html) };
  }

  private async loadVersion(db: Tx | PrismaService, a: AuthContext, id: string, n: number): Promise<FullVersion> {
    const v = await db.agreementVersion.findFirst({ where: { versionNumber: n, agreementId: id, agreement: { workspaceId: a.workspaceId } }, include: FULL });
    if (!v) throw notFound('Agreement version');
    return v;
  }
}
