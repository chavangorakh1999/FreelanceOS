'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  calculateEstimate, catalogItem, ESTIMATE_CATALOG, ESTIMATE_DEFAULTS, ESTIMATE_SOURCES, ESTIMATE_TEMPLATES, EstimateDiscount, EstimateInput, EstimateGroup,
  estimateToProposalLines, HourBasis, PaymentPlan, planPayments, MOBILE_FACTOR_SOURCES, MobilePlatform, Money, OVERHEAD_SOURCES, SourceId,
} from '@freelanceos/shared';
import { Crumbs } from '@/components/crumbs';
import { Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select } from '@/components/ui';
import { api, Client, Paged } from '@/lib/api';
import { fmtMoney } from '@/lib/format';

const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];
const GROUPS: EstimateGroup[] = ['Planning and design', 'Website', 'Accounts and payments', 'Web app', 'E-commerce', 'Mobile app', 'AI services', 'Launch'];
const BASES: [HourBasis, string, string][] = [['low', 'Lean', 'Lowest researched hours'], ['expected', 'Expected', 'Weighted average (low + 4 × likely + high) ÷ 6'], ['high', 'Safe', 'Highest researched hours']];
const STORE = 'fos.estimator.v1';
const fm = (m: Money) => fmtMoney({ amountMinor: m.amountMinor.toString(), currency: m.currency });

type Line = { key: string; itemId?: string; name?: string; qty: number; hours?: string };
type DiscountKind = EstimateDiscount['kind'];
type PlanKind = PaymentPlan['kind'];
interface State {
  currency: string; rate: string; basis: HourBasis; mobile: MobilePlatform; lines: Line[];
  qa: string; pm: string; contingency: string; discountKind: DiscountKind; discountValue: string; tax: string;
  plan: PlanKind; deposit: string; months: string; cycle: 'weekly' | 'fortnightly' | 'monthly'; dueDays: string;
}
const fresh = (currency: string): State => ({
  currency, rate: '45', basis: 'expected', mobile: 'cross', lines: [],
  qa: String(ESTIMATE_DEFAULTS.qaBps / 100), pm: String(ESTIMATE_DEFAULTS.pmBps / 100), contingency: String(ESTIMATE_DEFAULTS.contingencyBps / 100),
  discountKind: 'none', discountValue: '', tax: '0',
  plan: 'deposit', deposit: '50', months: '3', cycle: 'monthly', dueDays: '15',
});
const pctToBps = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(10_000, Math.round(n * 100)) : 0; };
const decimal = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim()) && Number(v) > 0;
const hrs = (h: number) => `${h % 1 === 0 ? h : h.toFixed(1)} h`;
let seq = 0;
const key = () => `l${Date.now().toString(36)}${seq++}`;

export default function EstimatorPage() {
  const [s, setS] = useState<State>(() => fresh('USD'));
  const [loaded, setLoaded] = useState(false);
  // The calculator remembers your rate and the current estimate in this browser.
  useEffect(() => { try { const raw = localStorage.getItem(STORE); if (raw) setS({ ...fresh('USD'), ...(JSON.parse(raw) as Partial<State>) }); } catch { /* unavailable */ } setLoaded(true); }, []);
  useEffect(() => { if (loaded) try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* unavailable */ } }, [s, loaded]);
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }));
  const [proposing, setProposing] = useState(false);

  const input: EstimateInput | null = useMemo(() => {
    if (!decimal(s.rate)) return null;
    const discount: EstimateDiscount = s.discountKind === 'percent' ? { kind: 'percent', bps: pctToBps(s.discountValue) }
      : s.discountKind === 'amount' && decimal(s.discountValue) ? { kind: 'amount', amount: s.discountValue.trim() }
      : s.discountKind === 'rate' && decimal(s.discountValue) ? { kind: 'rate', rate: s.discountValue.trim() } : { kind: 'none' };
    return {
      currency: s.currency, rate: s.rate.trim(), basis: s.basis, mobile: s.mobile, discount, taxBps: pctToBps(s.tax),
      qaBps: pctToBps(s.qa), pmBps: pctToBps(s.pm), contingencyBps: pctToBps(s.contingency),
      lines: s.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, hoursEach: l.hours !== undefined && l.hours.trim() !== '' && Number(l.hours) >= 0 ? Number(l.hours) : undefined })),
    };
  }, [s]);
  const r = useMemo(() => { try { return input ? calculateEstimate(input) : null; } catch { return null; } }, [input]);
  const plan: PaymentPlan = s.plan === 'deposit' ? { kind: 'deposit', depositBps: pctToBps(s.deposit) }
    : s.plan === 'milestone' ? { kind: 'milestone', depositBps: pctToBps(s.deposit), dueInDays: Number(s.dueDays) || 0 }
    : s.plan === 'monthly' ? { kind: 'monthly', months: Number(s.months) || 2 } : { kind: 'hourly', cycle: s.cycle, dueInDays: Number(s.dueDays) || 0 };
  const payments = useMemo(() => (r && r.totalHours > 0 ? planPayments(plan, r) : null), [r, plan.kind, s.deposit, s.months, s.cycle, s.dueDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = (id: string) => s.lines.find((l) => l.itemId === id);
  const toggle = (id: string) => set({ lines: chosen(id) ? s.lines.filter((l) => l.itemId !== id) : [...s.lines, { key: key(), itemId: id, qty: 1 }] });
  const patch = (k: string, p: Partial<Line>) => set({ lines: s.lines.map((l) => (l.key === k ? { ...l, ...p } : l)) });
  const applyTemplate = (id: string) => { const t = ESTIMATE_TEMPLATES.find((x) => x.id === id)!; set({ lines: t.items.map((i) => ({ key: key(), itemId: i.id, qty: i.qty ?? 1 })), ...(t.mobile ? { mobile: t.mobile } : {}) }); };
  const custom = s.lines.filter((l) => !l.itemId);
  const hasMobile = s.lines.some((l) => l.itemId && catalogItem(l.itemId)?.mobileClient);
  const lineResult = (l: Line) => r?.lines[s.lines.filter((x) => x.qty > 0).indexOf(l)];

  return (
    <>
      <title>Price calculator, FreelanceOS</title>
      <Crumbs items={[{ label: 'Proposals', href: '/proposals' }, { label: 'Price calculator' }]} />
      <PageHeader title="Price calculator" subtitle="Pick what the project needs. Hours come from published estimates; your rate and discount set the price."
        actions={<><Button onClick={() => setS({ ...fresh(s.currency), rate: s.rate })}><RotateCcw size={16} aria-hidden="true" />Start over</Button>
          <Button variant="primary" disabled={!r || r.totalHours === 0} onClick={() => setProposing(true)}>Create proposal</Button></>} />

      <section aria-labelledby="tpl-h" className="flex flex-col gap-2">
        <h2 id="tpl-h" className="text-sm font-medium text-ink-2">Start from a template</h2>
        <div className="flex flex-wrap gap-2">{ESTIMATE_TEMPLATES.map((t) => (
          <button key={t.id} type="button" onClick={() => applyTemplate(t.id)} className="btn-card flex flex-col items-start rounded-control px-3.5 py-2 text-left">
            <span className="text-sm font-medium">{t.name}</span><span className="text-[12px] text-muted">{t.description}</span>
          </button>))}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
          {GROUPS.map((g) => (
            <Card key={g} className="py-2" aria-labelledby={`g-${g}`}>
              <h2 id={`g-${g}`} className="px-5 pb-1 pt-4 text-lg font-semibold">{g}</h2>
              <ul className="divide-y divide-line">{ESTIMATE_CATALOG.filter((i) => i.group === g).map((i) => {
                const l = chosen(i.id); const lr = l && lineResult(l);
                return (
                  <li key={i.id} className={`flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3 ${l ? 'bg-accent-soft/30' : ''}`}>
                    <label className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={!!l} onChange={() => toggle(i.id)} />
                      <span className="min-w-0">
                        <span className="block font-medium">{i.name}{i.mobileClient && <span className="ml-2 text-[12px] font-normal text-muted">per app</span>}</span>
                        <span className="block text-[13px] text-muted">{i.detail}</span>
                        <span className="mt-0.5 block text-[12px] text-muted">Research: {i.low} to {i.high} h{i.unit ? ` per ${i.unit}` : ''}, likely {i.likely} h. <Sources ids={i.sources} /></span>
                      </span>
                    </label>
                    {l && (
                      <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
                        {i.unit && <Stepper value={l.qty} onChange={(qty) => patch(l.key, { qty })} label={`${i.name}, number of ${i.unit}s`} />}
                        <Input aria-label={`${i.name}, hours${i.unit ? ` per ${i.unit}` : ''}`} inputMode="decimal" className="h-9 w-20 text-right" placeholder={lr ? String(lr.hoursEach) : ''}
                          value={l.hours ?? ''} onChange={(e) => patch(l.key, { hours: e.target.value.replace(/[^\d.]/g, '') })} />
                        <span className="w-16 text-right text-sm font-medium tabular-nums">{lr ? hrs(lr.hours) : ''}</span>
                      </div>)}
                  </li>);
              })}</ul>
            </Card>))}

          <Card className="p-5" aria-labelledby="own-h">
            <h2 id="own-h" className="mb-1 text-lg font-semibold">Your own lines</h2>
            <p className="mb-3 text-[13px] text-muted">Anything not listed, with your own hours.</p>
            <ul className="flex flex-col gap-2">{custom.map((l) => (
              <li key={l.key} className="flex items-center gap-2">
                <Input aria-label="Work item" placeholder="e.g. Booking calendar" value={l.name ?? ''} onChange={(e) => patch(l.key, { name: e.target.value })} className="h-9" />
                <Input aria-label="Hours" inputMode="decimal" placeholder="Hours" value={l.hours ?? ''} onChange={(e) => patch(l.key, { hours: e.target.value.replace(/[^\d.]/g, '') })} className="h-9 w-24 text-right" />
                <Button variant="ghost" className="h-9 w-9 shrink-0 px-0" aria-label="Remove line" onClick={() => set({ lines: s.lines.filter((x) => x.key !== l.key) })}><Trash2 size={16} aria-hidden="true" /></Button>
              </li>))}
            </ul>
            <Button className="mt-3 h-9" onClick={() => set({ lines: [...s.lines, { key: key(), name: '', qty: 1, hours: '' }] })}><Plus size={16} aria-hidden="true" />Add a line</Button>
          </Card>

          <Card className="p-5" aria-labelledby="src-h">
            <h2 id="src-h" className="mb-2 text-lg font-semibold">How the numbers work</h2>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
              <li>Each item’s hours come from published ranges (agency and platform guides; links on every item). <em>Lean</em> uses the low end, <em>Safe</em> the high end, and <em>Expected</em> a weighted average: (low + 4 × likely + high) ÷ 6. Type your own hours to replace any figure.</li>
              <li>Two native apps instead of one cross-platform app multiply the app-side items by {1.65}, since cross-platform saves roughly 30 to 50% (<Sources ids={MOBILE_FACTOR_SOURCES} />).</li>
              <li>Testing and project management are a share of build hours; contingency is a share of everything (10 to 20% is typical: <Sources ids={OVERHEAD_SOURCES.contingency} />).</li>
              <li>Price = total hours × your rate, then the discount, then tax. Hours are kept to the half hour; money is exact.</li>
            </ol>
            <p className="text-[12px] text-muted">These are published estimates, mostly from agencies, not tracked projects. Treat them as a starting point and adjust to your own records.</p>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 lg:sticky lg:top-20">
          <Card className="flex flex-col gap-4 p-5" aria-labelledby="rate-h">
            <h2 id="rate-h" className="text-lg font-semibold">Your rate</h2>
            <div className="flex gap-2">
              <Select aria-label="Currency" value={s.currency} onChange={(e) => set({ currency: e.target.value })} className="w-24">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
              <Input aria-label="Hourly rate" inputMode="decimal" value={s.rate} onChange={(e) => set({ rate: e.target.value.replace(/[^\d.]/g, '') })} className="text-right" />
              <span className="self-center whitespace-nowrap text-sm text-muted">/ h</span>
            </div>
            {!decimal(s.rate) && <p role="alert" className="-mt-2 text-xs text-danger">Enter your hourly rate.</p>}
            <div role="radiogroup" aria-label="Hours to use" className="grid grid-cols-3 rounded-control border border-line bg-paper-2 p-0.5">
              {BASES.map(([b, label, title]) => <button key={b} type="button" role="radio" aria-checked={s.basis === b} title={title} onClick={() => set({ basis: b })}
                className={`h-8 rounded-[6px] text-[13px] font-medium ${s.basis === b ? 'bg-card text-ink shadow-card' : 'text-muted hover:text-ink'}`}>{label}</button>)}
            </div>
            {hasMobile && <Field label="Mobile apps">{(id) => <Select id={id} value={s.mobile} onChange={(e) => set({ mobile: e.target.value as MobilePlatform })}>
              <option value="cross">iOS and Android, one cross-platform app</option><option value="one-native">One platform, native</option><option value="two-native">iOS and Android, two native apps (×1.65)</option></Select>}</Field>}
            <div className="grid grid-cols-3 gap-2">
              <Pct label="Testing" value={s.qa} onChange={(qa) => set({ qa })} />
              <Pct label="Management" value={s.pm} onChange={(pm) => set({ pm })} />
              <Pct label="Contingency" value={s.contingency} onChange={(contingency) => set({ contingency })} />
            </div>
            <Field label="Discount">{(id) => (
              <div className="flex gap-2">
                <Select id={id} value={s.discountKind} onChange={(e) => set({ discountKind: e.target.value as DiscountKind, discountValue: '' })} className="flex-1">
                  <option value="none">None</option><option value="percent">% off the total</option><option value="amount">Amount off the total</option><option value="rate">Lower hourly rate</option></Select>
                {s.discountKind !== 'none' && <Input aria-label={s.discountKind === 'percent' ? 'Discount percent' : s.discountKind === 'rate' ? 'Discounted hourly rate' : 'Discount amount'} inputMode="decimal" className="w-28 text-right"
                  placeholder={s.discountKind === 'percent' ? '10' : s.discountKind === 'rate' ? String(Math.max(1, Math.round(Number(s.rate) * 0.9))) : '100'} value={s.discountValue} onChange={(e) => set({ discountValue: e.target.value.replace(/[^\d.]/g, '') })} />}
              </div>)}
            </Field>
            <Pct label="Tax (GST, VAT)" value={s.tax} onChange={(tax) => set({ tax })} />
          </Card>

          <Card className="p-5" aria-labelledby="sum-h">
            <h2 id="sum-h" className="mb-3 text-lg font-semibold">Estimate</h2>
            {!r || r.totalHours === 0 ? <p className="text-muted">Pick a template or tick what the project needs.</p> : (
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
                <dt className="text-ink-2">Build</dt><dd className="text-right tabular-nums">{hrs(r.buildHours)}</dd>
                <dt className="text-ink-2">Testing and fixes</dt><dd className="text-right tabular-nums">{hrs(r.qaHours)}</dd>
                <dt className="text-ink-2">Management</dt><dd className="text-right tabular-nums">{hrs(r.pmHours)}</dd>
                <dt className="text-ink-2">Contingency</dt><dd className="text-right tabular-nums">{hrs(r.contingencyHours)}</dd>
                <dt className="border-t border-line pt-1.5 font-medium">Total hours</dt><dd className="border-t border-line pt-1.5 text-right font-medium tabular-nums">{hrs(r.totalHours)}</dd>
                <dt className="mt-3 text-ink-2">{hrs(r.totalHours)} × {fm(r.rate)}</dt><dd className="mt-3 text-right tabular-nums">{fm(r.gross)}</dd>
                {r.discount.amountMinor > 0n && <><dt className="text-ink-2">{s.discountKind === 'rate' ? `Discount, billed at ${fm(r.billedRate)}/h` : 'Discount'}</dt><dd className="text-right tabular-nums">−{fm(r.discount)}</dd></>}
                {r.tax.amountMinor > 0n && <><dt className="text-ink-2">Tax</dt><dd className="text-right tabular-nums">{fm(r.tax)}</dd></>}
                <dt className="border-t border-line pt-2 text-base font-semibold">Price</dt><dd className="border-t border-line pt-2 text-right text-xl font-semibold tabular-nums">{fm(r.total)}</dd>
                <dd className="col-span-2 mt-2 text-[13px] text-muted">You earn {fm(r.effectiveRate)} per hour after discount. Lean to safe: {hrs(r.range.lowHours)} to {hrs(r.range.highHours)}, {fm(r.range.low)} to {fm(r.range.high)} before tax.</dd>
              </dl>)}
          </Card>
          <Card className="flex flex-col gap-3 p-5" aria-labelledby="pay-h">
            <h2 id="pay-h" className="text-lg font-semibold">Payment terms</h2>
            <Field label="How the client pays">{(id) => <Select id={id} value={s.plan} onChange={(e) => set({ plan: e.target.value as PlanKind, ...(e.target.value === 'milestone' && s.plan !== 'milestone' ? { deposit: '20', dueDays: '7' } : e.target.value === 'deposit' && s.plan !== 'deposit' ? { deposit: '50' } : e.target.value === 'hourly' && s.plan !== 'hourly' ? { dueDays: '15' } : {}) })}>
              <option value="deposit">Deposit, rest on completion</option><option value="milestone">By milestone</option><option value="monthly">Monthly payments</option><option value="hourly">Hourly, billed as worked</option></Select>}</Field>
            {(s.plan === 'deposit' || s.plan === 'milestone') && <div className="grid grid-cols-2 gap-2">
              <Pct label="Deposit" value={s.deposit} onChange={(deposit) => set({ deposit })} />
              {s.plan === 'milestone' && <Field label="Due in (days)">{(id) => <Input id={id} inputMode="numeric" className="text-right" value={s.dueDays} onChange={(e) => set({ dueDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} />}</Field>}
            </div>}
            {s.plan === 'monthly' && <Field label="Number of months" hint="2 to 12, the first payment on acceptance">{(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" className="text-right" value={s.months} onChange={(e) => set({ months: e.target.value.replace(/\D/g, '').slice(0, 2) })} />}</Field>}
            {s.plan === 'hourly' && <div className="grid grid-cols-2 gap-2">
              <Field label="Invoice every">{(id) => <Select id={id} value={s.cycle} onChange={(e) => set({ cycle: e.target.value as State['cycle'] })}><option value="weekly">Week</option><option value="fortnightly">2 weeks</option><option value="monthly">Month</option></Select>}</Field>
              <Field label="Due in (days)">{(id) => <Input id={id} inputMode="numeric" className="text-right" value={s.dueDays} onChange={(e) => set({ dueDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} />}</Field>
            </div>}
            {payments && (
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line text-[13px]" aria-label="Payment schedule">
                {payments.terms.map((t, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-ink-2">{t.label}{t.dueInDays ? <span className="text-muted">, due in {t.dueInDays} days</span> : null}</span>
                    <span className="shrink-0 text-right tabular-nums">{payments.amounts[i] ? <>{fm(payments.amounts[i]!)} <span className="text-muted">({(t.percentageBps! / 100).toFixed(t.percentageBps! % 100 ? 2 : 0)}%)</span></> : <span className="text-muted">hours × {fm(r!.billedRate)}</span>}</span>
                  </li>))}
              </ul>)}
            {payments && <p className="text-[12px] text-muted">{payments.description}</p>}
          </Card>
        </aside>
      </div>
      {r && r.totalHours > 0 && (
        <a href="#sum-h" className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-card border border-line bg-card/95 px-4 py-3 shadow-[var(--cast-stock-lift)] backdrop-blur lg:hidden">
          <span className="text-sm text-ink-2">{hrs(r.totalHours)} × {fm(r.billedRate)}</span><span className="text-lg font-semibold tabular-nums">{fm(r.total)}</span>
        </a>)}
      {proposing && input && r && payments && <ProposalDialog input={input} result={r} payments={payments} onClose={() => setProposing(false)} />}
    </>
  );
}

function Sources({ ids }: { ids: SourceId[] }) {
  return <>{ids.map((id, n) => { const src = ESTIMATE_SOURCES[id]; return (
    <span key={id}>{n > 0 && ', '}{src.url ? <a href={src.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-line-strong underline-offset-2 hover:text-ink" title={src.title}>{src.title.split(':')[0]}<ExternalLink size={10} aria-hidden="true" /></a> : <span title={src.title}>rule of thumb</span>}</span>); })}</>;
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="inline-flex h-9 items-center rounded-control border border-muted/60 bg-card" role="group" aria-label={label}>
      <button type="button" aria-label="Fewer" className="flex size-8 items-center justify-center text-muted hover:text-ink" onClick={() => onChange(Math.max(1, value - 1))}><Minus size={14} aria-hidden="true" /></button>
      <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">{value}</span>
      <button type="button" aria-label="More" className="flex size-8 items-center justify-center text-muted hover:text-ink" onClick={() => onChange(Math.min(200, value + 1))}><Plus size={14} aria-hidden="true" /></button>
    </span>
  );
}

function Pct({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}>{(id) => <div className="relative"><Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} className="pr-7 text-right" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span></div>}</Field>;
}

/** Turns the estimate into a draft proposal: one hourly line per item, the method in Assumptions, a 50/50 payment split. */
function ProposalDialog({ input, result, payments, onClose }: { input: EstimateInput; result: ReturnType<typeof calculateEstimate>; payments: ReturnType<typeof planPayments>; onClose: () => void }) {
  const router = useRouter();
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }) });
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const p = await api<{ id: string }>('/proposals', { body: { clientId, title: title.trim(), currency: input.currency } });
      const basis = input.basis === 'low' ? 'the low end of' : input.basis === 'high' ? 'the high end of' : 'a weighted average of';
      await api(`/proposals/${p.id}/versions/1`, { method: 'PUT', body: {
        pricingModel: payments.pricingModel, currency: input.currency,
        summary: `Estimated at ${result.totalHours} hours, including testing, project management and a contingency for unknowns. ${payments.description}`,
        sections: [
          { kind: 'SCOPE', title: 'Scope', body: result.lines.map((l) => `- ${l.name}${l.qty > 1 ? ` (${l.qty})` : ''}`).join('\n') },
          { kind: 'ASSUMPTIONS', title: 'How this was estimated', body: `Hours per item use ${basis} published industry ranges, adjusted where noted. Testing, project management and contingency are added as a share of the build. Work beyond this scope is quoted separately through a change request.` },
        ],
        lineItems: estimateToProposalLines(input, result),
        paymentTerms: payments.terms,
      } });
      return p.id;
    },
    onSuccess: (id) => router.push(`/proposals/${id}`),
  });
  return (
    <Dialog open onClose={onClose} title="Create a proposal from this estimate"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="est-prop" disabled={!clientId || !title.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create draft'}</Button></>}>
      <form id="est-prop" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Client">{(id) => <Select id={id} value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Choose a client…</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Proposal title">{(id) => <Input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website rebuild" />}</Field>
        <p className="text-[13px] text-muted">{estimateToProposalLines(input, result).length} hourly lines totalling {fm(result.total)}. {payments.description} It opens as a draft you can edit before sharing.</p>
        <ErrorNote error={create.error} />
      </form>
    </Dialog>
  );
}
