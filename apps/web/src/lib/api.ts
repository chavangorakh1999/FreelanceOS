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

interface Options { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null> }

export async function api<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()
    : '';
  const res = await fetch(`${API_URL}${path}${qs === '?' ? '' : qs}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
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
