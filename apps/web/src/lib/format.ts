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
};

export const describeAction = (action: string, meta: Record<string, unknown> | null) => LABELS[action]?.(meta) ?? action;
