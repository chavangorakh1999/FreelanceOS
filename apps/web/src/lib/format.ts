import { formatMoney, money } from '@freelanceos/shared';
import type { MoneyJson } from './api';

export const fmtMoney = (m: { amountMinor: string; currency: string } | MoneyJson, locale = 'en-IN') =>
  formatMoney(money(BigInt(m.amountMinor), m.currency), { locale });

export const fmtDate = (iso: string | Date, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }, locale = 'en-IN') =>
  new Intl.DateTimeFormat(locale, opts).format(new Date(iso));

export const fmtDateTime = (iso: string | Date) =>
  fmtDate(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const LABELS: Record<string, (m: Record<string, unknown> | null) => string> = {
  'workspace.created': () => 'Workspace created',
  'portal.invited': () => 'Client invited to the portal',
  'portal.invitation_revoked': () => 'Portal invitation cancelled',
  'portal.invitation_accepted': () => 'Client joined the portal',
  'portal.access_revoked': () => 'Portal access removed',
  'portal.access_updated': () => 'Portal access changed',
  'change_request.shared': () => 'Change request shared with the client',
  'auth.signed_in': () => 'Signed in',
  'auth.session_revoked': () => 'A session was revoked',
  'auth.password_changed': () => 'Password changed',
  'client.created': (m) => `Client created${m?.name ? `: ${String(m.name)}` : ''}`,
  'client.updated': () => 'Client updated',
  'client.archived': () => 'Client archived',
  'client.restored': () => 'Client restored',
  'client.interaction_logged': (m) => `Interaction logged${m?.type ? ` (${String(m.type).toLowerCase()})` : ''}`,
  'contact.created': () => 'Contact added',
  'contact.updated': () => 'Contact updated',
  'contact.archived': () => 'Contact archived',
  'contact.primary_changed': () => 'Primary contact changed',
  'engagement.created': () => 'Engagement created',
  'engagement.updated': () => 'Engagement updated',
  'engagement.stage_changed': (m) => `Moved to ${m?.toName ? String(m.toName) : 'a new stage'}`,
  'engagement.archived': () => 'Engagement archived',
  'engagement.restored': () => 'Engagement restored',
  'engagement.requirement_added': () => 'Requirement added',
  'proposal.created': () => 'Proposal created',
  'proposal.shared': () => 'Proposal shared',
  'proposal.accepted': () => 'Proposal accepted',
  'proposal.rejected': () => 'Proposal rejected',
  'proposal.changes_requested': () => 'Changes requested on a proposal',
  'agreement.created': () => 'Agreement created',
  'agreement.sent': () => 'Agreement sent for signature',
  'agreement.signer_signed': () => 'A signature was recorded',
  'agreement.signed': () => 'Agreement fully signed',
  'agreement.declined': () => 'Agreement declined',
  'agreement.voided': () => 'Agreement voided',
  'project.created': () => 'Project created',
  'project.status_changed': (m) => `Project ${String(m?.to ?? '').toLowerCase().replace('_', ' ')}`,
  'scope.submitted': () => 'Scope submitted for review',
  'scope.approved': () => 'Scope approved and frozen',
  'scope.changes_requested': () => 'Scope sent back for changes',
  'milestone.created': () => 'Milestone added',
  'milestone.status_changed': (m) => `Milestone ${String(m?.to ?? '').toLowerCase().replace('_', ' ')}`,
  'task.status_changed': (m) => `Task ${String(m?.to ?? '').toLowerCase().replace('_', ' ')}`,
  'change_request.submitted': () => 'Change request raised',
  'change_request.assessed': () => 'Change impact assessed',
  'change_request.withdrawn': () => 'Change request withdrawn',
  'change_request.addendum_completed': () => 'Agreement addendum recorded',
  'invoice.draft_created': () => 'Invoice drafted',
  'invoice.draft_saved': () => 'Invoice draft saved',
  'invoice.draft_deleted': () => 'Invoice draft deleted',
  'invoice.issued': (m) => `Invoice ${m?.number ? String(m.number) + ' ' : ''}issued`,
  'invoice.voided': (m) => `Invoice ${m?.number ? String(m.number) + ' ' : ''}voided`,
  'invoice.shared': () => 'Invoice shared with the client',
  'credit_note.issued': (m) => `Credit note ${m?.number ? String(m.number) : ''} issued`,
  'payment.recorded': () => 'Payment recorded',
  'payment.allocated': () => 'Payment applied to invoices',
  'payment.reversed': () => 'Payment reversed',
};

export const describeAction = (action: string, meta: Record<string, unknown> | null) => LABELS[action]?.(meta) ?? action;
