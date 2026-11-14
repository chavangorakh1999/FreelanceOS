const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

// The access token lives in memory only. The long-lived refresh token is an httpOnly cookie
// the browser sends to /auth/* — script on the page can never read it.
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };

export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) { accessToken = null; return false; }
      accessToken = ((await r.json()) as { accessToken: string }).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

interface Options { method?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string | number | boolean | undefined | null> }

export async function api<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()
    : '';
  const res = await fetch(`${API_URL}${path}${qs === '?' ? '' : qs}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/setup') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}

// ───────── shared response types ─────────

export interface MoneyJson { amountMinor: string; currency: string; decimal: string }
export interface Contact { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; jobTitle: string | null; isPrimary: boolean }
export interface Client {
  id: string; type: 'COMPANY' | 'INDIVIDUAL'; name: string; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  email: string | null; phone: string | null; website: string | null; taxIdentifier: string | null; notes: string | null; tags: string[];
  createdAt: string; engagementCount: number; primaryContact?: Contact | null; contacts?: Contact[];
}
export interface Stage { id: string; name: string; kind: 'OPEN' | 'WON' | 'LOST' | 'ON_HOLD'; position: number; probabilityBps: number }
export interface Engagement {
  id: string; title: string; description: string | null; serviceCategory: string | null; source: string | null;
  currency: string; estimatedValue: MoneyJson; lostReason: string | null; followUpAt: string | null; archivedAt: string | null;
  client: { id: string; name: string }; stage: { id: string; name: string; kind: Stage['kind'] };
  requirements?: { id: string; kind: string; title: string; detail: string | null }[];
  stageHistory?: { id: string; fromStageId: string | null; toStageId: string; reason: string | null; createdAt: string }[];
}
export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number }
export interface AuditEvent { id: string; action: string; targetType: string; targetId: string; metadata: Record<string, unknown> | null; createdAt: string }
export interface Dashboard {
  activeClients: number; openEngagements: number; recentActivity: AuditEvent[];
  pipeline: { stageId: string; name: string; kind: Stage['kind']; count: number; valueByCurrency: { currency: string; amountMinor: string }[] }[];
}
export interface SessionInfo { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; lastUsedAt: string; current: boolean }

/** Download a protected file. The access token lives in memory, so a plain <a href> cannot carry it. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const send = () => fetch(`${API_URL}${path}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) {
    const e = ((await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? 'Download failed');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ───────── Phase 2 types ─────────

export type ProposalStatus = 'DRAFT' | 'SHARED' | 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED';
export type VersionStatus = ProposalStatus | 'SUPERSEDED';
export interface ProposalSummary {
  id: string; number: string; title: string; status: ProposalStatus; client: { id: string; name: string };
  latestVersion: { versionNumber: number; status: VersionStatus; validUntil: string | null; total: MoneyJson };
}
export interface ProposalDetail {
  id: string; number: string; title: string; status: ProposalStatus; acceptedVersionId: string | null;
  client: { id: string; name: string }; engagement: { id: string; title: string } | null;
  versions: { id: string; versionNumber: number; status: VersionStatus; sharedAt: string | null; validUntil: string | null; totals: { total: MoneyJson } }[];
  decisions: { id: string; versionId: string; decision: 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED'; channel: string; decidedAt: string; note: string | null }[];
}
export interface ProposalVersion {
  id: string; versionNumber: number; status: VersionStatus; currency: string; pricingModel: string; validUntil: string | null; summary: string | null;
  sharedAt: string | null; expired: boolean;
  totals: { subtotal: MoneyJson; discount: MoneyJson; tax: MoneyJson; total: MoneyJson };
  sections: { kind: string; title: string; body: string }[];
  lineItems: { description: string; quantity: string; unitLabel: string; unitRate: MoneyJson; discountBps: number; taxBps: number; net: MoneyJson }[];
  paymentTerms: { label: string; kind: string; percentageBps: number | null; dueInDays: number | null; amount: MoneyJson | null }[];
}
export type AgreementStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'PARTIALLY_SIGNED' | 'SIGNED' | 'DECLINED' | 'EXPIRED' | 'VOIDED';
export interface AgreementSummary {
  id: string; number: string; title: string; status: AgreementStatus; expiresAt: string | null;
  client: { id: string; name: string }; proposal: { id: string; number: string } | null;
}
export interface AgreementDetail extends AgreementSummary {
  voidReason: string | null; proposal: { id: string; number: string; title: string } | null;
  versions: { id: string; versionNumber: number; status: string; sentAt: string | null; signedAt: string | null; contentHash: string | null }[];
}
export interface Signer { id: string; role: 'FREELANCER' | 'CLIENT' | 'WITNESS'; name: string; email: string; signingOrder: number; status: 'PENDING' | 'SIGNED' | 'DECLINED'; signedAt: string | null; declineReason: string | null }
export interface AgreementVersion {
  id: string; versionNumber: number; status: 'DRAFT' | 'SENT' | 'SIGNED' | 'DECLINED' | 'VOID'; contentHash: string | null; sentAt: string | null; signedAt: string | null;
  clauses: { heading: string; body: string }[]; signers: Signer[];
  events: { id: string; type: string; method: string; occurredAt: string; evidence: string | null; signerId: string | null }[];
}
export interface TemplateInfo { id: string; kind: 'PROPOSAL' | 'AGREEMENT'; name: string; description: string | null }
