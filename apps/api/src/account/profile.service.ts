import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './account.dto';

const SETTINGS = ['invoicePrefix', 'defaultPaymentTermsDays', 'defaultTaxBps'] as const;
const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(a: AuthContext) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId } });
    const st = await this.prisma.workspaceSettings.findUnique({ where: { workspaceId: a.workspaceId } });
    const { id, name, legalName, email, phone, addressLine1, addressLine2, city, region, postalCode, country, taxIdentifier, paymentInstructions, defaultCurrency, timezone } = ws;
    return {
      id, name, legalName, email, phone, addressLine1, addressLine2, city, region, postalCode, country, taxIdentifier, paymentInstructions, defaultCurrency, timezone,
      invoicePrefix: st?.invoicePrefix ?? 'INV', defaultPaymentTermsDays: st?.defaultPaymentTermsDays ?? 30, defaultTaxBps: st?.defaultTaxBps ?? 1800,
      // What a client needs to see on an invoice; the app nudges until these are filled.
      complete: Boolean(addressLine1 && city && country && paymentInstructions),
    };
  }

  async update(a: AuthContext, dto: UpdateProfileDto) {
    if (a.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Only the workspace owner can change the business profile', 403);
    if (dto.timezone && !validTimezone(dto.timezone)) throw new DomainError('INVALID_TIMEZONE', `Unknown time zone: ${dto.timezone}`, 422);
    const settings = Object.fromEntries(SETTINGS.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k]]));
    const profile = Object.fromEntries(Object.entries(dto).filter(([k, v]) => v !== undefined && !(SETTINGS as readonly string[]).includes(k)));
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(profile).length) await tx.workspace.update({ where: { id: a.workspaceId }, data: profile });
      if (Object.keys(settings).length) await tx.workspaceSettings.upsert({ where: { workspaceId: a.workspaceId }, create: { workspaceId: a.workspaceId, ...settings }, update: settings });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'workspace.profile_updated', targetType: 'workspace', targetId: a.workspaceId, ip: a.ip, metadata: { fields: Object.keys(dto).filter((k) => dto[k as keyof UpdateProfileDto] !== undefined) } });
    });
    return this.get(a);
  }
}
