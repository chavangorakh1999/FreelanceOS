'use client';

import { WhoSees } from '@/components/who-sees';
import { Crumbs } from '@/components/crumbs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateInvoice, formatMoney, hasPlaceholder, parseMoney, placeholderTitles } from '@freelanceos/shared';
import { ChevronDown, ChevronUp, Download, FilePlus2, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CommentsPanel } from '@/components/comments';
import { LinkedRecords } from '@/components/linked-records';
import { AgreementBadge, LockedBadge, ProjectBadge, ProposalBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, btnPrimary, btnSecondary } from '@/components/ui';
import { api, ApiError, downloadFile, ProposalDetail, ProposalVersion } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, trimDecimal } from '@/lib/format';
import type { CommentItem } from '@/lib/portal-api';

const PRICING = ['FIXED', 'MILESTONE', 'HOURLY', 'DAILY', 'TIME_AND_MATERIALS', 'RETAINER', 'HYBRID'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const problems = (e: unknown): string[] | null => (e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]) : null);

export default function ProposalPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['proposal', id], queryFn: () => api<ProposalDetail>(`/proposals/${id}`) });
  const [picked, setPicked] = useState<number | null>(null);
  const n = picked ?? detail.data?.versions[0]?.versionNumber ?? 1;
  const version = useQuery({ queryKey: ['proposal', id, 'v', n], queryFn: () => api<ProposalVersion>(`/proposals/${id}/versions/${n}`), enabled: !!detail.data });
  const [deciding, setDeciding] = useState(false);
  const [pdfError, setPdfError] = useState<unknown>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['proposal', id] }); void qc.invalidateQueries({ queryKey: ['proposals'] }); };
  const newVersion = useMutation({ mutationFn: () => api<ProposalVersion>(`/proposals/${id}/versions`, { method: 'POST' }), onSuccess: (v) => { refresh(); setPicked(v.versionNumber); } });
  const duplicate = useMutation({ mutationFn: () => api<{ id: string }>(`/proposals/${id}/duplicate`, { method: 'POST' }), onSuccess: (p) => { refresh(); window.location.assign(`/proposals/${p.id}`); } });

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <><PageHeader title="Proposal not found" /><ErrorNote error={detail.error} /><Link href="/proposals" className="text-accent hover:underline">Back to proposals</Link></>;
  const p = detail.data;
  const latest = p.versions[0]!;
  const v = version.data;
  const isLive = v?.status === 'SHARED' && v.versionNumber === latest.versionNumber;

  return (
    <>
      <title>{`${p.title}, FreelanceOS`}</title>
      <Crumbs items={[{ label: 'Proposals', href: '/proposals' }, { label: p.number }]} />
      <PageHeader title={p.title} subtitle={`${p.number}, ${p.client.name}${p.engagement ? `, ${p.engagement.title}` : ''}`}
        actions={<div className="flex flex-wrap items-center gap-2">{v?.status === 'DRAFT' && <ProposalBadge status={p.status} />}
          <Button onClick={() => { setPdfError(null); downloadFile(`/proposals/${id}/versions/${n}/pdf`, `${p.number}-v${n}.pdf`).catch(setPdfError); }}><Download size={16} aria-hidden="true" />PDF</Button></div>} />
      <ErrorNote error={pdfError ?? newVersion.error ?? duplicate.error} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
          {version.isLoading || !v ? <Spinner /> : v.status === 'DRAFT'
            ? <DraftEditor key={v.id} proposalId={id} clientId={p.client.id} version={v} onChanged={refresh} />
            : <VersionView version={v} />}
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="act-h">
            <h2 id="act-h" className="mb-3 text-lg font-semibold">Next steps</h2>
            <div className="flex flex-col gap-2">
              {isLive && <Button variant="primary" onClick={() => setDeciding(true)}>Record client decision</Button>}
              {/* The next lifecycle step is the primary action, and a step already taken links to its record instead (PRD §8.1). */}
              {p.status === 'ACCEPTED' && p.agreements.length === 0 && <Link href={`/agreements?new=1&clientId=${p.client.id}&proposalId=${p.id}`} className={btnPrimary}><FilePlus2 size={16} aria-hidden="true" />Create agreement</Link>}
              {p.status === 'ACCEPTED' && p.projects.length === 0 && <Link href={`/projects?new=1&clientId=${p.client.id}&proposalId=${p.id}${p.engagement ? `&engagementId=${p.engagement.id}` : ''}`} className={p.agreements.length > 0 ? btnPrimary : btnSecondary}>Start project</Link>}
              {latest.status === 'DRAFT' && <p className="text-[13px] text-muted">Finish the draft, then share it from the bar at the bottom of the page.</p>}
              {p.status !== 'ACCEPTED' && latest.status !== 'DRAFT' && <Button onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>Start new version</Button>}
              <Button variant="ghost" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>{p.status === 'ACCEPTED' ? 'Duplicate as replacement' : 'Duplicate proposal'}</Button>
            </div>
            <LinkedRecords rows={[
              ...(p.engagement ? [{ kind: 'Engagement', label: p.engagement.title, href: `/engagements/${p.engagement.id}` }] : []),
              ...p.agreements.map((a) => ({ kind: 'Agreement', label: a.number, href: `/agreements/${a.id}`, status: <AgreementBadge status={a.status} /> })),
              ...p.projects.map((x) => ({ kind: 'Project', label: x.name, href: `/projects/${x.id}`, status: <ProjectBadge status={x.status} /> })),
            ]} />
            {p.status === 'ACCEPTED' && <p className="mt-3 text-[13px] text-muted">An accepted proposal is final. To change terms, duplicate it as a replacement or handle the change through a change request.</p>}
          </Card>

          <Card className="p-6" aria-labelledby="ver-h">
            <h2 id="ver-h" className="mb-3 text-lg font-semibold">Versions</h2>
            <ul className="flex flex-col gap-1">
              {p.versions.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setPicked(x.versionNumber)} aria-current={x.versionNumber === n ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-3 rounded-control border px-3 py-2.5 text-left ${x.versionNumber === n ? 'border-line-strong bg-stat' : 'border-transparent hover:bg-stat'}`}>
                    <span><span className="font-medium">Version {x.versionNumber}</span><span className="block text-[13px] text-muted">{fmtMoney(x.totals.total)}{x.sharedAt ? `, shared ${fmtDate(x.sharedAt)}` : ''}</span></span>
                    <ProposalBadge status={x.status} />
                  </button>
                </li>))}
            </ul>
          </Card>

          {p.decisions.length > 0 && (
            <Card className="p-6" aria-labelledby="dec-h">
              <h2 id="dec-h" className="mb-3 text-lg font-semibold">Decisions</h2>
              <ul className="flex flex-col gap-4">{p.decisions.map((d) => (
                <li key={d.id}><div className="font-medium">{label(d.decision)} <span className="font-normal text-muted"> version {p.versions.find((x) => x.id === d.versionId)?.versionNumber}</span></div>
                  <div className="text-[13px] text-muted">{label(d.channel)}, {fmtDateTime(d.decidedAt)}</div>{d.note && <div className="mt-1 text-ink-2">{d.note}</div>}</li>))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <CommentsPanel staff shared={p.versions.some((x) => x.status !== 'DRAFT')} queryKey={['staff-comments', 'proposal', id]}
        load={() => api<CommentItem[]>(`/proposals/${id}/comments`)} post={(body, visibility) => api(`/proposals/${id}/comments`, { body: { body, visibility } })} />
      {v && <DecisionDialog open={deciding} onClose={() => setDeciding(false)} proposalId={id} version={v} onDone={() => { setDeciding(false); refresh(); }} />}
    </>
  );
}

// ───────────────────────── read-only view ─────────────────────────

function VersionView({ version: v }: { version: ProposalVersion }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ProposalBadge status={v.status} />
        <LockedBadge>Version {v.versionNumber} is locked</LockedBadge>
        {v.expired && <Badge tone="warn">Expired {v.validUntil && fmtDate(v.validUntil)}</Badge>}
        <span className="text-[13px] text-muted">{v.sharedAt ? `Shared ${fmtDateTime(v.sharedAt)}` : ''}{v.validUntil && !v.expired ? `, valid until ${fmtDate(v.validUntil)}` : ''}</span>
      </div>
      {v.summary && <Card className="p-6"><p className="whitespace-pre-wrap">{v.summary}</p></Card>}
      {v.sections.map((s, i) => (
        <Card key={i} className="p-6"><h2 className="mb-2 text-lg font-semibold">{s.title}</h2><p className="whitespace-pre-wrap text-ink-2">{s.body || 'None'}</p></Card>
      ))}
      <Card className="py-6" aria-labelledby="price-h">
        <h2 id="price-h" className="px-6 pb-4 text-lg font-semibold">Pricing <span className="text-sm font-normal text-muted"> {label(v.pricingModel)}</span></h2>
        <Table minWidth={560}>
          <thead><tr><Th>Description</Th><Th right>Qty</Th><Th right>Rate</Th><Th right>Amount</Th></tr></thead>
          <tbody>{v.lineItems.map((l, i) => (<tr key={i}><Td>{l.description}{l.taxBps > 0 && <div className="text-[13px] text-muted">GST {l.taxBps / 100}%</div>}</Td><Td right>{l.quantity} {l.unitLabel}</Td><Td right>{fmtMoney(l.unitRate)}</Td><Td right>{fmtMoney(l.net)}</Td></tr>))}</tbody>
        </Table>
        <div className="ml-auto mt-4 flex w-[300px] max-w-full flex-col gap-2 px-6">
          <Row k="Subtotal" v={fmtMoney(v.totals.subtotal)} />
          {BigInt(v.totals.discount.amountMinor) > 0n && <Row k="Discounts" v={`−${fmtMoney(v.totals.discount)}`} />}
          <Row k="Tax" v={fmtMoney(v.totals.tax)} />
          <div className="flex justify-between border-t border-dashed border-line-strong pt-3 text-lg font-semibold"><span>Total</span><span>{fmtMoney(v.totals.total)}</span></div>
        </div>
      </Card>
      <Card className="p-6" aria-labelledby="terms-h">
        <h2 id="terms-h" className="mb-3 text-lg font-semibold">Payment terms</h2>
        <ul className="flex flex-col divide-y divide-line">{v.paymentTerms.map((t, i) => (
          <li key={i} className="flex justify-between gap-4 py-2.5"><span>{t.label}</span><span className="text-ink-2">{[t.percentageBps != null ? `${t.percentageBps / 100}%` : null, t.amount ? fmtMoney(t.amount) : null, t.dueInDays != null ? `within ${t.dueInDays} days` : null].filter(Boolean).join(', ')}</span></li>))}
        </ul>
      </Card>
    </>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between text-ink-2"><span>{k}</span><span>{v}</span></div>;

// ───────────────────────── draft editor ─────────────────────────

interface Line { description: string; quantity: string; unitLabel: string; unitRate: string; discountPct: string; taxPct: string }
interface Term { label: string; kind: string; percent: string; dueInDays: string }
const pctToBps = (s: string) => Math.min(10000, Math.max(0, Math.round(Number(s || '0') * 100)));
const bpsToPct = (b: number | null) => (b == null ? '' : String(b / 100));

function DraftEditor({ proposalId, clientId, version: v, onChanged }: { proposalId: string; clientId: string; version: ProposalVersion; onChanged: () => void }) {
  const qc = useQueryClient();
  const [pricingModel, setPricingModel] = useState(v.pricingModel);
  const [currency, setCurrency] = useState(v.currency);
  const [validUntil, setValidUntil] = useState(v.validUntil ? v.validUntil.slice(0, 10) : '');
  const [summary, setSummary] = useState(v.summary ?? '');
  const [sections, setSections] = useState(v.sections.map((s) => ({ kind: s.kind, title: s.title, body: s.body })));
  const [lines, setLines] = useState<Line[]>(v.lineItems.map((l) => ({ description: l.description, quantity: trimDecimal(l.quantity), unitLabel: l.unitLabel, unitRate: l.unitRate.decimal, discountPct: String(l.discountBps / 100), taxPct: String(l.taxBps / 100) })));
  const [terms, setTerms] = useState<Term[]>(v.paymentTerms.map((t) => ({ label: t.label, kind: t.kind, percent: bpsToPct(t.percentageBps), dueInDays: t.dueInDays == null ? '' : String(t.dueInDays) })));
  const [sharing, setSharing] = useState(false);

  const payload = useMemo(() => ({
    pricingModel, currency, validUntil: validUntil || null, summary: summary || undefined,
    sections,
    lineItems: lines.map((l) => ({ description: l.description, quantity: l.quantity || '0', unitLabel: l.unitLabel || undefined, unitRate: l.unitRate || '0', discountBps: pctToBps(l.discountPct), taxBps: pctToBps(l.taxPct) })),
    paymentTerms: terms.map((t) => ({ label: t.label, kind: t.kind, percentageBps: t.percent !== '' ? pctToBps(t.percent) : undefined, dueInDays: t.dueInDays !== '' ? Number(t.dueInDays) : undefined })),
  }), [pricingModel, currency, validUntil, summary, sections, lines, terms]);
  const [saved, setSaved] = useState(() => JSON.stringify(payload));
  const dirty = JSON.stringify(payload) !== saved;

  // Preview totals with the same shared library the server uses; the server remains authoritative.
  const preview = useMemo(() => {
    try {
      const c = calculateInvoice(currency, payload.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, unitRate: parseMoney(l.unitRate, currency), discountBps: l.discountBps, taxBps: l.taxBps })));
      return { ok: true as const, c };
    } catch (e) { return { ok: false as const, message: (e as Error).message }; }
  }, [payload, currency]);
  const unfinished = placeholderTitles(sections);
  const summaryUnfinished = hasPlaceholder(summary);
  const pctSum = terms.length > 0 && terms.every((t) => t.percent !== '') ? terms.reduce((s, t) => s + pctToBps(t.percent), 0) : null;

  const save = useMutation({
    mutationFn: () => api(`/proposals/${proposalId}/versions/${v.versionNumber}`, { method: 'PUT', body: payload }),
    onSuccess: () => { setSaved(JSON.stringify(payload)); void qc.invalidateQueries({ queryKey: ['proposal', proposalId] }); },
  });
  const share = useMutation({
    mutationFn: async () => { await api(`/proposals/${proposalId}/versions/${v.versionNumber}`, { method: 'PUT', body: payload }); return api(`/proposals/${proposalId}/versions/${v.versionNumber}/share`, { method: 'POST' }); },
    onSuccess: () => { setSharing(false); onChanged(); },
  });

  const move = (i: number, d: -1 | 1) => setSections((s) => { const j = i + d; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  const upd = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) => set((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ProposalBadge status="DRAFT" />
        <span className="text-[13px] text-muted">Version {v.versionNumber} is a draft. It becomes locked when you share it.</span>
        {dirty && <Badge tone="warn">Unsaved changes</Badge>}
      </div>
      {(unfinished.length > 0 || summaryUnfinished) && (
        <p role="status" className="rounded-control bg-warn-soft px-4 py-3 text-warn-ink">
          Template guidance in [square brackets] is still in {summaryUnfinished ? 'the summary' : ''}{summaryUnfinished && unfinished.length ? ' and ' : ''}{unfinished.length ? unfinished.join(', ') : ''}. Replace it before sharing.
        </p>
      )}

      <Card className="p-6" aria-labelledby="basics-h">
        <h2 id="basics-h" className="mb-4 text-lg font-semibold">Basics</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <Field label="Pricing model">{(id) => <Select id={id} value={pricingModel} onChange={(e) => setPricingModel(e.target.value)}>{PRICING.map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
          <Field label="Valid until" hint="Required to share.">{(id, d) => <Input id={id} aria-describedby={d} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
        </div>
        <div className="mt-4"><Field label="Summary (optional)">{(id) => <Textarea id={id} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field></div>
      </Card>

      {sections.map((s, i) => (
        <Card key={i} className="p-6" aria-label={`Section ${i + 1}`}>
          <div className="mb-3 flex items-end gap-2">
            <div className="min-w-0 flex-1"><Field label={`Section ${i + 1} title`}>{(id) => <Input id={id} value={s.title} onChange={(e) => upd(setSections, i, { title: e.target.value })} />}</Field></div>
            <Button variant="ghost" aria-label={`Move section ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className="px-2.5"><ChevronUp size={16} aria-hidden="true" /></Button>
            <Button variant="ghost" aria-label={`Move section ${i + 1} down`} disabled={i === sections.length - 1} onClick={() => move(i, 1)} className="px-2.5"><ChevronDown size={16} aria-hidden="true" /></Button>
            <Button variant="ghost" aria-label={`Remove section ${i + 1}`} onClick={() => setSections((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button>
          </div>
          <Field label="Content">{(id) => <Textarea id={id} rows={4} value={s.body} onChange={(e) => upd(setSections, i, { body: e.target.value })} />}</Field>
        </Card>
      ))}
      <div><Button onClick={() => setSections((s) => [...s, { kind: 'CUSTOM', title: 'New section', body: '' }])}><Plus size={16} aria-hidden="true" />Add section</Button></div>

      <Card className="p-6" aria-labelledby="lines-h">
        <h2 id="lines-h" className="mb-4 text-lg font-semibold">Pricing</h2>
        <div className="flex flex-col gap-4">
          {lines.map((l, i) => (
            <fieldset key={i} className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] items-end gap-3 rounded-stat bg-stat p-4">
              <legend className="sr-only">Line {i + 1}</legend>
              <div className="col-span-full"><Field label={`Line ${i + 1} description`}>{(id) => <Input id={id} value={l.description} onChange={(e) => upd(setLines, i, { description: e.target.value })} />}</Field></div>
              <Field label="Quantity">{(id) => <Input id={id} inputMode="decimal" value={l.quantity} onChange={(e) => upd(setLines, i, { quantity: e.target.value })} />}</Field>
              <Field label="Unit">{(id) => <Input id={id} value={l.unitLabel} onChange={(e) => upd(setLines, i, { unitLabel: e.target.value })} placeholder="hour, day…" />}</Field>
              <Field label={`Rate (${currency})`}>{(id) => <Input id={id} inputMode="decimal" value={l.unitRate} onChange={(e) => upd(setLines, i, { unitRate: e.target.value })} />}</Field>
              <Field label="Discount %">{(id) => <Input id={id} inputMode="decimal" value={l.discountPct} onChange={(e) => upd(setLines, i, { discountPct: e.target.value })} />}</Field>
              <Field label="Tax %">{(id) => <Input id={id} inputMode="decimal" value={l.taxPct} onChange={(e) => upd(setLines, i, { taxPct: e.target.value })} />}</Field>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{preview.ok && preview.c.lines[i] ? formatMoney(preview.c.lines[i]!.net, { locale: 'en-IN' }) : 'None'}</span>
                <Button variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button>
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-4"><Button onClick={() => setLines((a) => [...a, { description: '', quantity: '1', unitLabel: 'unit', unitRate: '0', discountPct: '0', taxPct: '18' }])}><Plus size={16} aria-hidden="true" />Add line</Button></div>
        <div className="ml-auto mt-5 flex w-[300px] max-w-full flex-col gap-2">
          {preview.ok ? (<>
            <Row k="Subtotal" v={formatMoney(preview.c.subtotal, { locale: 'en-IN' })} />
            <Row k="Tax" v={formatMoney(preview.c.taxTotal, { locale: 'en-IN' })} />
            <div className="flex justify-between border-t border-dashed border-line-strong pt-3 text-lg font-semibold"><span>Total</span><span>{formatMoney(preview.c.total, { locale: 'en-IN' })}</span></div>
          </>) : <p role="alert" className="text-sm text-danger">{preview.message}</p>}
        </div>
      </Card>

      <Card className="p-6" aria-labelledby="terms-h">
        <h2 id="terms-h" className="mb-4 text-lg font-semibold">Payment terms</h2>
        <div className="flex flex-col gap-3">
          {terms.map((t, i) => (
            <div key={i} className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] items-end gap-3">
              <Field label={`Term ${i + 1}`}>{(id) => <Input id={id} value={t.label} onChange={(e) => upd(setTerms, i, { label: e.target.value })} />}</Field>
              <Field label="When">{(id) => <Select id={id} value={t.kind} onChange={(e) => upd(setTerms, i, { kind: e.target.value })}><option value="UPFRONT">On acceptance</option><option value="MILESTONE">On milestone</option><option value="ON_COMPLETION">On completion</option><option value="NET_DAYS">Net days</option></Select>}</Field>
              <Field label="Percent">{(id) => <Input id={id} inputMode="decimal" value={t.percent} onChange={(e) => upd(setTerms, i, { percent: e.target.value })} />}</Field>
              <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label="Due in days">{(id) => <Input id={id} inputMode="numeric" value={t.dueInDays} onChange={(e) => upd(setTerms, i, { dueInDays: e.target.value })} />}</Field></div>
                <Button variant="ghost" aria-label={`Remove term ${i + 1}`} onClick={() => setTerms((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button></div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => setTerms((a) => [...a, { label: '', kind: 'MILESTONE', percent: '', dueInDays: '' }])}><Plus size={16} aria-hidden="true" />Add term</Button>
          {pctSum != null && <span className={pctSum === 10000 ? 'text-ok-ink' : 'text-warn-ink'} role="status">{pctSum === 10000 ? 'Percentages total 100%' : `Percentages total ${pctSum / 100}%, they must add up to 100% to share`}</span>}
        </div>
      </Card>

      <ErrorNote error={save.error && !problems(save.error) ? save.error : null} />
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-card border border-line bg-card/95 p-3 shadow-[var(--cast-stock-lift)] backdrop-blur">
        {save.isSuccess && !dirty && <span role="status" className="mr-auto text-sm text-ok-ink">Draft saved</span>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
        <Button variant="primary" onClick={() => { share.reset(); setSharing(true); }}>Share with client…</Button>
      </div>

      <Dialog open={sharing} onClose={() => setSharing(false)} title={`Share version ${v.versionNumber}`}
        footer={<><Button onClick={() => setSharing(false)}>Cancel</Button><Button variant="primary" onClick={() => share.mutate()} disabled={share.isPending}>{share.isPending ? 'Sharing…' : 'Share and lock'}</Button></>}>
        <p className="text-ink-2">Sharing saves this draft and <strong>locks it permanently</strong>. Anything you change afterwards becomes a new version, so the client’s decision always refers to exactly what they saw.</p>
        <div className="mt-4"><WhoSees clientId={clientId} what="this proposal" /></div>
        {problems(share.error) && <ul role="alert" className="mt-4 list-disc rounded-control bg-danger-soft py-2 pl-8 pr-3 text-sm text-danger">{problems(share.error)!.map((x) => <li key={x}>{x}</li>)}</ul>}
        <div className="mt-3"><ErrorNote error={share.error && !problems(share.error) ? share.error : null} /></div>
      </Dialog>
    </>
  );
}

// ───────────────────────── decision dialog ─────────────────────────

function DecisionDialog({ open, onClose, proposalId, version, onDone }: { open: boolean; onClose: () => void; proposalId: string; version: ProposalVersion; onDone: () => void }) {
  const [decision, setDecision] = useState('ACCEPTED');
  const [channel, setChannel] = useState('EMAIL');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/proposals/${proposalId}/versions/${version.versionNumber}/decision`, { body: { decision, channel, note: note || undefined, decidedAt: date ? new Date(date + 'T12:00:00').toISOString() : undefined } }),
    onSuccess: () => { setNote(''); onDone(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Record decision on version ${version.versionNumber}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="decision" disabled={m.isPending}>{m.isPending ? 'Recording…' : 'Record decision'}</Button></>}>
      <form id="decision" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">Record what the client told you. It is saved against <strong>version {version.versionNumber}</strong> ({fmtMoney(version.totals.total)}) and cannot be edited afterwards.</p>
        <Field label="Decision">{(id) => <Select id={id} value={decision} onChange={(e) => setDecision(e.target.value)}><option value="ACCEPTED">Accepted</option><option value="CHANGES_REQUESTED">Changes requested</option><option value="REJECTED">Rejected</option></Select>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How did you receive it?">{(id) => <Select id={id} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="EMAIL">Email</option><option value="MEETING">Meeting or call</option><option value="OTHER">Other</option></Select>}</Field>
          <Field label="Date (optional)" hint="Defaults to now.">{(id, d) => <Input id={id} aria-describedby={d} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <Field label={decision === 'CHANGES_REQUESTED' ? 'What changes were requested?' : 'Note / evidence (optional)'} hint="E.g. who confirmed it and where.">{(id, d) => <Textarea id={id} aria-describedby={d} required={decision === 'CHANGES_REQUESTED'} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
