import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { sniff } from '../library/file-type';
import { FILE_STORAGE, FileStorage } from '../library/storage';
import type { Upload } from '../library/library.service';
import { PrismaService } from '../prisma/prisma.service';

const MAX_LOGO = 1024 * 1024;
const IMAGE = ['image/png', 'image/jpeg', 'image/webp'];

/** The business logo: one private image per workspace, checked by its bytes (no SVG: it can carry script). */
@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  async upload(a: AuthContext, file: Upload | undefined) {
    if (a.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Only the workspace owner can change the logo', 403);
    if (!file?.buffer?.length) throw new DomainError('FILE_REQUIRED', 'Choose an image', 422);
    if (file.size > MAX_LOGO) throw new DomainError('FILE_TOO_LARGE', 'The logo must be 1 MB or smaller', 422);
    const kind = sniff(file.buffer, file.originalname);
    if (!kind || !IMAGE.includes(kind.mimeType)) throw new DomainError('FILE_TYPE_NOT_ALLOWED', 'Use a PNG, JPEG or WebP image', 422);
    const key = `${a.workspaceId}/branding/${randomUUID()}`;
    await this.storage.put(key, file.buffer);
    await this.prisma.$transaction(async (tx) => {
      await tx.workspace.update({ where: { id: a.workspaceId }, data: { logoStorageKey: key, logoMimeType: kind.mimeType, logoUpdatedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'workspace.logo_updated', targetType: 'workspace', targetId: a.workspaceId, ip: a.ip, metadata: { mimeType: kind.mimeType, bytes: file.size } });
    });
    return { hasLogo: true };
  }

  async remove(a: AuthContext) {
    if (a.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Only the workspace owner can change the logo', 403);
    await this.prisma.$transaction(async (tx) => {
      await tx.workspace.update({ where: { id: a.workspaceId }, data: { logoStorageKey: null, logoMimeType: null, logoUpdatedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'workspace.logo_removed', targetType: 'workspace', targetId: a.workspaceId, ip: a.ip });
    });
  }

  async file(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { logoStorageKey: true, logoMimeType: true } });
    if (!ws.logoStorageKey || !ws.logoMimeType) throw notFound('Logo');
    return { bytes: await this.storage.get(ws.logoStorageKey), mimeType: ws.logoMimeType, fileName: `logo.${ws.logoMimeType.split('/')[1]}` };
  }

  /** For PDFs: the logo inline, or null. */
  async dataUrl(workspaceId: string): Promise<string | null> {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { logoStorageKey: true, logoMimeType: true } });
    if (!ws.logoStorageKey || !ws.logoMimeType) return null;
    try { return `data:${ws.logoMimeType};base64,${(await this.storage.get(ws.logoStorageKey)).toString('base64')}`; } catch { return null; }
  }
}
