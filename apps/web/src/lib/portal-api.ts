import { ApiError, MoneyJson } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// A separate token from the staff one: the portal is a different identity with its own refresh cookie (path /portal/auth).
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
export const setPortalToken = (t: string | null) => { accessToken = t; };

export function refreshPortal(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/portal/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) { accessToken = null; return false; }
      accessToken = ((await r.json()) as { accessToken: string }).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

interface Options { method?: string; body?: unknown }
const AUTHLESS = ['/portal/auth/login', '/portal/auth/accept', '/portal/auth/refresh', '/portal/auth/invitations'];

export async function papi<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !retried && !AUTHLESS.some((p) => path.startsWith(p))) {
    if (await refreshPortal()) return papi<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}

export async function portalDownload(path: string, fallbackName: string): Promise<void> {
  const send = () => fetch(`${API_URL}${path}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await send();
  if (res.status === 401 && (await refreshPortal())) res = await send();
  if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', 'Download failed');
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ───────── response types ─────────

export type Role = 'VIEWER' | 'APPROVER';
export interface PortalMe { user: { id: string; name: string; email: string }; role: Role; organization: { id: string; name: string }; businessName: string; membershipId: string }
export interface PortalOrg { membershipId: string; organizationName: string; businessName: string; role: Role }
export interface InvitationInfo { valid: boolean; businessName?: string; organizationName?: string; firstName?: string; role?: Role; existingAccount?: boolean }

export interface PProposalItem { id: string; number: string; title: string; versionNumber: number; status: string; validUntil: string | null; expired: boolean; sharedAt: string | null; total: MoneyJson; needsDecision: boolean }
export interface PProposalDetail {
  id: string; number: string; title: string; status: string; canDecide: boolean;
  versions: { versionNumber: number; status: string; sharedAt: string | null }[];
  version: {
    versionNumber: number; status: string; currency: string; validUntil: string | null; summary: string | null; expired: boolean;
    totals: { subtotal: MoneyJson; discount: MoneyJson; tax: MoneyJson; total: MoneyJson };
    sections: { id: string; title: string; body: string }[];
    lineItems: { id: string; description: string; quantity: string; unitLabel: string; unitRate: MoneyJson; net: MoneyJson; taxBps: number }[];
    paymentTerms: { id: string; label: string; percentageBps: number | null; amount: MoneyJson | null; dueInDays: number | null }[];
    decision: { decision: string; decidedAt: string; note: string | null; byYou: boolean } | null;
  };
}
export interface PAgreementItem { id: string; number: string; title: string; status: string; sentAt: string | null; signedAt: string | null; expiresAt: string | null; needsMySignature: boolean }
export interface PAgreementDetail {
  id: string; number: string; title: string; status: string; versionStatus: string; sentAt: string | null; signedAt: string | null; expiresAt: string | null; contentHash: string | null; businessName: string;
  clauses: { id: string; heading: string; body: string }[];
  signers: { id: string; role: string; name: string; status: string; signedAt: string | null; isYou: boolean }[];
  you: { signerId: string; name: string; status: string } | null; canSign: boolean; waitingFor: string | null;
}
export interface Progress { done: number; total: number; basisPoints: number }
export interface PProjectItem { id: string; number: string; name: string; status: string; startDate: string | null; targetDate: string | null; progress: Progress; openChanges: number }
export interface PProjectDetail {
  id: string; number: string; name: string; description: string | null; status: string; startDate: string | null; targetDate: string | null; progress: Progress;
  milestones: { id: string; name: string; description: string | null; dueDate: string | null; status: string; progress: Progress; deliverables: { id: string; title: string; done: boolean }[] }[];
  tasks: { id: string; title: string; description: string | null; status: string; dueDate: string | null; milestoneId: string | null }[];
}
export interface PScopeVersion { versionNumber: number; status: string; summary: string | null; submittedAt: string | null; approvedAt: string | null; items: { id: string; kind: string; title: string; description: string }[]; decision: { decision: string; decidedAt: string; note: string | null; byYou: boolean } | null }
export interface PScope { baseline: PScopeVersion | null; inReview: PScopeVersion | null; history: { versionNumber: number; status: string }[]; canDecide: boolean }
export interface PChange {
  id: string; number: string; title: string; description: string; reason: string; status: string; requestedBy: string; requesterName: string | null; requestedAt: string;
  project: { id: string; name: string; number: string }; addendumRequired: boolean; canDecide: boolean;
  assessment: { costDelta: MoneyJson; timelineDeltaDays: number; deliverablesImpact: string; dependenciesImpact: string; risk: string; requiresAddendum: boolean } | null;
  decisions: { party: string; decision: string; decidedAt: string; note?: string | null; byYou?: boolean }[];
}
export interface PInvoiceItem { id: string; number: string | null; status: 'PAID' | 'DUE' | 'OVERDUE' | 'VOID'; issueDate: string | null; dueDate: string | null; total: MoneyJson; outstanding: MoneyJson; project: { name: string; number: string } | null }
export interface PInvoiceDetail {
  id: string; number: string | null; status: string; issueDate: string | null; dueDate: string | null; paymentTermsDays: number; notes: string | null;
  supplier: { name: string | null; taxId: string | null; address: string | null }; billTo: { name: string | null; taxId: string | null; address: string | null };
  project: { name: string; number: string } | null;
  totals: { subtotal: MoneyJson; discount: MoneyJson; tax: MoneyJson; total: MoneyJson };
  lines: { id: string; description: string; quantity: string; unitLabel: string; unitRate: MoneyJson; net: MoneyJson; taxBps: number }[];
  balance: { total: MoneyJson; cashReceived: MoneyJson; withheld: MoneyJson; credited: MoneyJson; outstanding: MoneyJson };
  payments: { receivedAt: string; method: string; cash: MoneyJson; withholding: MoneyJson }[]; creditNotes: { number: string; amount: MoneyJson; reason: string }[];
}
export interface PDashboard {
  organizationName: string; businessName: string; role: Role; unreadNotifications: number;
  attention: { proposals: PProposalItem[]; agreements: PAgreementItem[]; scopeReviews: { projectId: string; projectName: string; versionNumber: number }[]; changes: PChange[]; invoices: PInvoiceItem[] };
  counts: { proposals: number; agreements: number; projects: number; invoices: number };
}
export interface NotificationItem { id: string; category: string; title: string; body: string; linkPath: string; readAt: string | null; createdAt: string }
export interface PrefItem { category: string; label: string; emailEnabled: boolean; locked?: boolean }
export interface CommentItem { id: string; body: string; authorName: string; authorKind: 'TEAM' | 'CLIENT'; createdAt: string; mine: boolean; visibility?: 'INTERNAL' | 'CLIENT_VISIBLE' }
