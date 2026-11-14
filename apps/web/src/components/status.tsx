import { CheckCircle2, CircleDashed, Clock, FileEdit, Lock, MessageSquareWarning, Send, XCircle, Ban, Eye, PenLine, TimerOff, History } from 'lucide-react';
import { Badge } from './ui';

type Tone = 'neutral' | 'success' | 'warn' | 'info' | 'danger';
const I = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const;

const PROPOSAL: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: <FileEdit {...I} /> },
  SHARED: { label: 'Shared', tone: 'info', icon: <Send {...I} /> },
  ACCEPTED: { label: 'Accepted', tone: 'success', icon: <CheckCircle2 {...I} /> },
  REJECTED: { label: 'Rejected', tone: 'danger', icon: <XCircle {...I} /> },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'warn', icon: <MessageSquareWarning {...I} /> },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral', icon: <History {...I} /> },
};
const AGREEMENT: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: <FileEdit {...I} /> },
  SENT: { label: 'Awaiting signatures', tone: 'info', icon: <Send {...I} /> },
  VIEWED: { label: 'Viewed', tone: 'info', icon: <Eye {...I} /> },
  PARTIALLY_SIGNED: { label: 'Partially signed', tone: 'warn', icon: <PenLine {...I} /> },
  SIGNED: { label: 'Signed', tone: 'success', icon: <CheckCircle2 {...I} /> },
  DECLINED: { label: 'Declined', tone: 'danger', icon: <XCircle {...I} /> },
  EXPIRED: { label: 'Expired', tone: 'warn', icon: <TimerOff {...I} /> },
  VOIDED: { label: 'Void', tone: 'neutral', icon: <Ban {...I} /> },
  VOID: { label: 'Void', tone: 'neutral', icon: <Ban {...I} /> },
};

const fallback = { label: '', tone: 'neutral' as Tone, icon: <CircleDashed {...I} /> };
export const ProposalBadge = ({ status }: { status: string }) => { const s = PROPOSAL[status] ?? { ...fallback, label: status }; return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>; };
export const AgreementBadge = ({ status }: { status: string }) => { const s = AGREEMENT[status] ?? { ...fallback, label: status }; return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>; };
export const LockedBadge = ({ children = 'Locked' }: { children?: React.ReactNode }) => <Badge icon={<Lock {...I} />}>{children}</Badge>;
export const PendingBadge = ({ children }: { children: React.ReactNode }) => <Badge tone="warn" icon={<Clock {...I} />}>{children}</Badge>;

const PROJECT: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  PLANNING: { label: 'Planning', tone: 'neutral', icon: <CircleDashed {...I} /> },
  ACTIVE: { label: 'Active', tone: 'success', icon: <CheckCircle2 {...I} /> },
  ON_HOLD: { label: 'On hold', tone: 'warn', icon: <Clock {...I} /> },
  COMPLETED: { label: 'Completed', tone: 'info', icon: <CheckCircle2 {...I} /> },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: <Ban {...I} /> },
};
const SCOPE: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: <FileEdit {...I} /> },
  IN_REVIEW: { label: 'In review', tone: 'info', icon: <Eye {...I} /> },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'warn', icon: <MessageSquareWarning {...I} /> },
  APPROVED: { label: 'Approved · frozen', tone: 'success', icon: <Lock {...I} /> },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral', icon: <History {...I} /> },
};
const CHANGE: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  SUBMITTED: { label: 'Submitted', tone: 'info', icon: <Send {...I} /> },
  NEEDS_CLARIFICATION: { label: 'Needs clarification', tone: 'warn', icon: <MessageSquareWarning {...I} /> },
  ASSESSED: { label: 'Assessed', tone: 'info', icon: <PenLine {...I} /> },
  APPROVED: { label: 'Approved', tone: 'success', icon: <CheckCircle2 {...I} /> },
  REJECTED: { label: 'Rejected', tone: 'danger', icon: <XCircle {...I} /> },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral', icon: <Ban {...I} /> },
};
const MILESTONE: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  PLANNED: { label: 'Planned', tone: 'neutral', icon: <CircleDashed {...I} /> },
  IN_PROGRESS: { label: 'In progress', tone: 'info', icon: <Clock {...I} /> },
  DELIVERED: { label: 'Delivered', tone: 'warn', icon: <Send {...I} /> },
  ACCEPTED: { label: 'Accepted', tone: 'success', icon: <CheckCircle2 {...I} /> },
};
const mk = (m: Record<string, { label: string; tone: Tone; icon: React.ReactNode }>) => ({ status }: { status: string }) => {
  const s = m[status] ?? { ...fallback, label: status };
  return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>;
};
export const ProjectBadge = mk(PROJECT);
export const ScopeBadge = mk(SCOPE);
export const ChangeBadge = mk(CHANGE);
export const MilestoneBadge = mk(MILESTONE);
