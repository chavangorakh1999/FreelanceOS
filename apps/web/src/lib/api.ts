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
  proposals?: { id: string; number: string; title: string; status: ProposalStatus }[];
  projects?: { id: string; number: string; name: string; status: ProjectStatus }[];
}
export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number }
export interface AuditEvent { id: string; action: string; targetType: string; targetId: string; metadata: Record<string, unknown> | null; createdAt: string }
export interface AttentionInvoice { id: string; number: string | null; client: string; dueDate: string | null; outstanding: MoneyJson }
export interface Dashboard {
  attention: {
    overdueInvoices: AttentionInvoice[];
    proposalsAwaitingClient: { id: string; number: string; title: string; client: string }[];
    changesToAssess: { id: string; number: string; title: string; project: string }[];
    scopeInReview: { projectId: string; project: string; versionNumber: number }[];
  };
  upcoming: { milestones: { id: string; name: string; dueDate: string; project: { id: string; name: string } }[]; invoicesDue: AttentionInvoice[] };
  activeClients: number; activeProjects: number; openEngagements: number; recentActivity: AuditEvent[]; finance: FinanceOverview;
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
  agreements: { id: string; number: string; title: string; status: AgreementStatus }[];
  projects: { id: string; number: string; name: string; status: ProjectStatus }[];
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

// ───────── Phase 3 types ─────────

export interface Progress { done: number; total: number; basisPoints: number }
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export interface ProjectSummary {
  id: string; number: string; name: string; status: ProjectStatus; targetDate: string | null; startDate: string | null;
  client: { id: string; name: string }; progress: Progress;
}
export interface ProjectDetail extends Omit<ProjectSummary, 'client'> {
  description: string | null; visibility: string; clientId: string;
  client: { id: string; name: string };
  engagement: { id: string; title: string } | null;
  proposal: { id: string; number: string; title: string } | null;
  agreement: { id: string; number: string; title: string; status: string } | null;
  milestoneCount: number; openChangeRequests: number;
  baseline: { versionNumber: number; approvedAt: string | null } | null;
  latestScopeVersion: { versionNumber: number; status: ScopeStatus } | null;
}
export type ScopeStatus = 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'SUPERSEDED';
export type ScopeKind = 'REQUIREMENT' | 'FEATURE' | 'DELIVERABLE' | 'ASSUMPTION' | 'EXCLUSION' | 'ACCEPTANCE_CRITERION';
export interface ScopeItem { itemKey: string; kind: ScopeKind; title: string; description: string }
export interface ScopeApproval { decision: 'APPROVED' | 'CHANGES_REQUESTED'; channel: string; approverName: string | null; decidedAt: string; note: string | null }
export interface ScopeVersionSummary {
  id: string; versionNumber: number; status: ScopeStatus; summary: string | null; submittedAt: string | null; approvedAt: string | null;
  itemCount: number; approval: ScopeApproval | null; changeRequest: { id: string; number: string; title: string } | null;
}
export interface ScopeOverview { documentId: string; baseline: number | null; versions: ScopeVersionSummary[] }
export interface ScopeVersionFull {
  id: string; versionNumber: number; status: ScopeStatus; summary: string | null; submittedAt: string | null; approvedAt: string | null;
  items: ScopeItem[]; approval: ScopeApproval | null; resultOfRequest: { id: string; number: string; title: string } | null;
}
export interface ScopeDiff { from: number; to: number; added: ScopeItem[]; removed: ScopeItem[]; changed: { before: ScopeItem; after: ScopeItem }[]; unchangedCount: number }
export type MilestoneStatus = 'PLANNED' | 'IN_PROGRESS' | 'DELIVERED' | 'ACCEPTED';
export interface Milestone {
  id: string; name: string; description: string | null; dueDate: string | null; status: MilestoneStatus; progress: Progress;
  deliverables: { id: string; title: string; done: boolean }[];
}
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export interface Task {
  id: string; title: string; description: string | null; internalNotes: string | null; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: TaskStatus; dueDate: string | null; milestoneId: string | null; dependsOn: string[]; blockedBy: string[]; visibility: 'INTERNAL' | 'CLIENT_VISIBLE' | 'SHARED_WITH_SELECTED_CONTACTS';
}
export type ChangeStatus = 'SUBMITTED' | 'NEEDS_CLARIFICATION' | 'ASSESSED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export interface Assessment {
  id: string; costDelta: MoneyJson; timelineDeltaDays: number; deliverablesImpact: string; dependenciesImpact: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH'; riskNotes: string | null; requiresAddendum: boolean; createdAt: string;
}
export interface ChangeSummary {
  id: string; number: string; title: string; status: ChangeStatus; requestedBy: 'FREELANCER' | 'CLIENT'; requestedAt: string;
  latestAssessment: Assessment | null; project?: { id: string; name: string; number: string; client: { id: string; name: string } };
}
export interface ChangeDetail extends Omit<ChangeSummary, 'project'> {
  description: string; reason: string; requesterName: string | null; addendumStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'COMPLETED'; addendumNote: string | null; withdrawnReason: string | null;
  project: { id: string; name: string; number: string; status: ProjectStatus };
  baseScopeVersion: { versionNumber: number; status: ScopeStatus }; resultingVersion: { versionNumber: number; status: ScopeStatus } | null;
  assessments: Assessment[];
  decisions: { id: string; party: 'FREELANCER' | 'CLIENT'; decision: 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED'; channel: string; decidedAt: string; note: string | null }[];
  delta: { added: ScopeItem[]; removed: ScopeItem[]; changed: { before: ScopeItem; after: ScopeItem }[]; unchangedCount: number } | null;
  readiness: { readyToStart: boolean; blockers: string[] };
  visibility: 'INTERNAL' | 'CLIENT_VISIBLE'; sharedAt: string | null;
}

// ───────── Phase 4 types ─────────

export type InvoiceState = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID' | 'CREDITED';
export interface InvoiceBalance { total: MoneyJson; cashReceived: MoneyJson; withheld: MoneyJson; credited: MoneyJson; outstanding: MoneyJson }
export interface InvoiceSummary {
  id: string; number: string | null; stored: 'DRAFT' | 'ISSUED' | 'VOID'; status: InvoiceState; currency: string; issueDate: string | null; dueDate: string | null;
  total: MoneyJson; balance: InvoiceBalance; client: { id: string; name: string };
}
export interface InvoiceLine { id: string; description: string; quantity: string; unitLabel: string; unitRate: MoneyJson; discountBps: number; taxBps: number; net: MoneyJson; tax: MoneyJson }
export interface InvoiceDetail extends Omit<InvoiceSummary, 'client'> {
  client: { id: string; name: string }; project: { id: string; name: string; number: string } | null; milestone: { id: string; name: string } | null;
  changeRequest: { id: string; number: string; title: string } | null;
  supplier: { name: string | null; taxId: string | null; address: string | null }; billTo: { name: string | null; taxId: string | null; address: string | null };
  notes: string | null; paymentTermsDays: number; voidReason: string | null; visibility: 'INTERNAL' | 'CLIENT_VISIBLE' | 'SHARED_WITH_SELECTED_CONTACTS'; sharedAt: string | null; issuedAt: string | null;
  totals: { subtotal: MoneyJson; discount: MoneyJson; tax: MoneyJson; total: MoneyJson };
  lines: InvoiceLine[];
  allocations: { id: string; createdAt: string; cash: MoneyJson; withholding: MoneyJson; payment: { id: string; receivedAt: string; method: string; reference: string | null; reversed: boolean } }[];
  creditNotes: { id: string; number: string; reason: string; issuedAt: string; amount: MoneyJson }[];
}
export interface PaymentSummary {
  id: string; clientId: string; receivedAt: string; method: string; reference: string | null; currency: string; amount: MoneyJson; allocated: MoneyJson; withheld: MoneyJson;
  unallocated: MoneyJson; reversed: boolean; reversedAt: string | null; reversalReason: string | null; client: { id: string; name: string };
}
export interface PaymentDetail extends PaymentSummary {
  note: string | null;
  allocations: { id: string; createdAt: string; invoice: { id: string; number: string | null }; cash: MoneyJson; withholding: MoneyJson }[];
}
export interface CurrencyOverview {
  currency: string; invoiced: MoneyJson; cashReceived: MoneyJson; withheld: MoneyJson; credited: MoneyJson; outstanding: MoneyJson; overdue: MoneyJson; unallocatedCash: MoneyJson;
  openInvoices: number; overdueInvoices: number; ageing: { bucket: 'NOT_DUE' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_90_PLUS'; amount: MoneyJson }[];
}
export interface FinanceOverview { period: { from: string; to: string }; asOf: string; currencies: CurrencyOverview[] }

// ───────── Phase 5 types ─────────

export interface PortalContactRow {
  contactId: string; name: string; email: string | null; isPrimary: boolean; projectIds: string[];
  membership: { id: string; role: 'VIEWER' | 'APPROVER'; status: 'ACTIVE' | 'REVOKED'; lastActive: string | null; accountEmail: string } | null;
  invitation: { id: string; status: 'PENDING' | 'EXPIRED'; expiresAt: string; role: 'VIEWER' | 'APPROVER' } | null;
}
export interface PortalOverview { client: { id: string; name: string }; projects: { id: string; name: string; number: string; visibility: string }[]; contacts: PortalContactRow[] }
export interface EmailDelivery { id: string; toEmail: string; category: string; subject: string; status: 'PENDING' | 'SENT' | 'FAILED' | 'DEAD'; attempts: number; nextAttemptAt: string | null; lastError: string | null; sentAt: string | null; createdAt: string }
