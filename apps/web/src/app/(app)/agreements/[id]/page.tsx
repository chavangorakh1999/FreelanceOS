'use client';

import { WhoSees } from '@/components/who-sees';
import { Crumbs } from '@/components/crumbs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Hash, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SignatureImage } from '@/components/signature-image';
import { SignaturePad, SignatureValue } from '@/components/signature-pad';
import { AgreementBadge, LockedBadge } from '@/components/status';
import { useMe } from '@/lib/auth';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { hasPlaceholder } from '@freelanceos/shared';
import { AgreementDetail, AgreementVersion, api, ApiError, downloadFile, fetchBlobUrl, Signer } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const problems = (e: unknown): string[] | null => (e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]) : null);

export default function AgreementPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['agreement', id], queryFn: () => api<AgreementDetail>(`/agreements/${id}`) });
  const n = detail.data?.versions[0]?.versionNumber ?? 1;
  const version = useQuery({ queryKey: ['agreement', id, 'v', n], queryFn: () => api<AgreementVersion>(`/agreements/${id}/versions/${n}`), enabled: !!detail.data });
  const [voiding, setVoiding] = useState(false);
  const [recording, setRecording] = useState<{ signer: Signer; type: 'SIGNED' | 'DECLINED' } | null>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const [signing, setSigning] = useState<Signer | null>(null);
  const me = useMe();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['agreement', id] }); void qc.invalidateQueries({ queryKey: ['agreements'] }); };

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <><PageHeader title="Agreement not found" /><ErrorNote error={detail.error} /><Link href="/agreements" className="text-accent hover:underline">Back to agreements</Link></>;
  const ag = detail.data;
  const v = version.data;
  const open = v?.status === 'SENT' && ['SENT', 'VIEWED', 'PARTIALLY_SIGNED'].includes(ag.status);
  const canVoid = !['SIGNED', 'VOIDED'].includes(ag.status);

  return (
    <>
      <title>{`${ag.title}, FreelanceOS`}</title>
      <Crumbs items={[{ label: 'Agreements', href: '/agreements' }, { label: ag.number }]} />
      <PageHeader title={ag.title}
        subtitle={<>{ag.number}, <Link href={`/clients/${ag.client.id}`} className="hover:underline">{ag.client.name}</Link>{ag.proposal && <>, from <Link href={`/proposals/${ag.proposal.id}`} className="hover:underline">{ag.proposal.number}</Link></>}</>}
        actions={<div className="flex flex-wrap items-center gap-2"><AgreementBadge status={ag.status} />
          <Button onClick={() => { setPdfError(null); downloadFile(`/agreements/${id}/versions/${n}/pdf`, `${ag.number}-v${n}.pdf`).catch(setPdfError); }}><Download size={16} aria-hidden="true" />PDF</Button>
          {canVoid && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}</div>} />
      <ErrorNote error={pdfError} />
      {ag.status === 'VOIDED' && ag.voidReason && <p className="rounded-control bg-stat px-4 py-3 text-ink-2">Voided: {ag.voidReason}</p>}
      {ag.status === 'EXPIRED' && <p className="rounded-control bg-warn-soft px-4 py-3 text-warn-ink">The signing deadline ({ag.expiresAt && fmtDate(ag.expiresAt)}) has passed. No more signatures can be recorded on this agreement.</p>}

      {!v ? <Spinner /> : v.status === 'DRAFT' ? <DraftEditor key={v.id} agreementId={id} clientId={ag.client.id} version={v} onChanged={refresh} /> : (
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2"><LockedBadge>Locked since {v.sentAt ? fmtDate(v.sentAt) : 'sending'}</LockedBadge>
              {v.contentHash && <span className="inline-flex items-center gap-1.5 text-[13px] text-muted" title="SHA-256 of the clauses and signers at the moment this was sent"><Hash size={14} aria-hidden="true" />Fingerprint <code className="rounded bg-stat px-1.5 py-0.5">{v.contentHash.slice(0, 16)}…</code></span>}</div>
            {/* A contract reads as one document: one sheet, numbered clauses ruled apart. */}
            <Card className="px-6 py-2 sm:px-8" aria-label="Agreement text">
              <ol>{v.clauses.map((c, i) => (
                <li key={i} className="border-b border-line py-5 last:border-b-0"><h2 className="mb-1.5 text-base font-semibold">{i + 1}. {c.heading}</h2><p className="whitespace-pre-wrap text-ink-2">{c.body}</p></li>
              ))}</ol>
            </Card>
          </div>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
            <Card className="p-6" aria-labelledby="sig-h">
              <h2 id="sig-h" className="mb-1 text-lg font-semibold">Signatures</h2>
              <p className="mb-4 text-[13px] text-muted">Signers sign in order. Clients sign in their portal and you sign here. For a signature collected another way, record it with its proof.</p>
              <ul className="flex flex-col divide-y divide-line">{v.signers.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="font-medium">{s.signingOrder}. {s.name}</div><div className="truncate text-[13px] text-muted">{label(s.role)}, {s.email}</div>{s.signedAt && <div className="text-[13px] text-muted">Signed {fmtDate(s.signedAt)}</div>}
                      {(() => { const e = v.events.find((x) => x.type === 'SIGNED' && x.signerId === s.id && (x.signatureKind === 'DRAWN' || x.signatureKind === 'UPLOADED')); return e ? <SignatureImage path={`/agreements/${id}/signatures/${e.id}/image`} load={fetchBlobUrl} name={s.name} /> : null; })()}</div>
                    {s.status === 'SIGNED' ? <Badge tone="success">Signed</Badge> : s.status === 'DECLINED' ? <Badge tone="danger">Declined</Badge> : <Badge tone="warn">Pending</Badge>}
                  </div>
                  {s.declineReason && <p className="mt-1 text-[13px] text-ink-2">{s.declineReason}</p>}
                  {open && s.status === 'PENDING' && s.role === 'FREELANCER' && s.email.toLowerCase() === me.user.email.toLowerCase() ? <div className="mt-2"><Button variant="primary" className="h-9 px-4" onClick={() => setSigning(s)}>Sign now</Button></div>
                    : open && s.status === 'PENDING' && <div className="mt-2 flex flex-wrap gap-1"><Button className="h-8 whitespace-nowrap px-3 text-[13px]" onClick={() => setRecording({ signer: s, type: 'SIGNED' })}>Signed elsewhere</Button><Button variant="ghost" className="h-8 whitespace-nowrap px-3 text-[13px]" onClick={() => setRecording({ signer: s, type: 'DECLINED' })}>Declined</Button></div>}
                </li>))}
              </ul>
            </Card>
            <Card className="p-6" aria-labelledby="trail-h">
              <h2 id="trail-h" className="mb-4 text-lg font-semibold">Signature trail</h2>
              <ol className="flex flex-col gap-4">{[...v.events].reverse().map((e, i) => (
                <li key={e.id} className="flex gap-3"><span aria-hidden="true" className={`mt-1 h-5 w-[3px] shrink-0 rounded-sm ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`} />
                  <div><div className="font-medium">{label(e.type)}{e.signerId && `, ${v.signers.find((s) => s.id === e.signerId)?.name ?? ''}`}</div>{e.evidence && <div className="text-ink-2">{e.evidence}</div>}<div className="text-[13px] text-muted">{label(e.method)}, {fmtDateTime(e.occurredAt)}</div></div></li>))}
              </ol>
            </Card>
          </div>
        </div>
      )}

      <VoidDialog open={voiding} agreementId={id} onClose={() => setVoiding(false)} onDone={() => { setVoiding(false); refresh(); }} />
      {signing && <SignDialog agreementId={id} n={n} signer={signing} onClose={() => setSigning(null)} onDone={() => { setSigning(null); refresh(); }} />}
      {recording && <RecordDialog agreementId={id} n={n} signer={recording.signer} type={recording.type} onClose={() => setRecording(null)} onDone={() => { setRecording(null); refresh(); }} />}
    </>
  );
}

interface Clause { heading: string; body: string }
interface SignerRow { role: Signer['role']; name: string; email: string; signingOrder: number }

function DraftEditor({ agreementId, clientId, version: v, onChanged }: { agreementId: string; clientId: string; version: AgreementVersion; onChanged: () => void }) {
  const [clauses, setClauses] = useState<Clause[]>(v.clauses.map((c) => ({ heading: c.heading, body: c.body })));
  const [signers, setSigners] = useState<SignerRow[]>(v.signers.map((s) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })));
  const [confirm, setConfirm] = useState(false);
  const payload = { clauses, signers };
  const [saved, setSaved] = useState(() => JSON.stringify(payload));
  const dirty = JSON.stringify(payload) !== saved;
  const save = useMutation({ mutationFn: () => api(`/agreements/${agreementId}/versions/${v.versionNumber}`, { method: 'PUT', body: payload }), onSuccess: () => { setSaved(JSON.stringify(payload)); onChanged(); } });
  const send = useMutation({
    mutationFn: async () => { await api(`/agreements/${agreementId}/versions/${v.versionNumber}`, { method: 'PUT', body: payload }); return api(`/agreements/${agreementId}/versions/${v.versionNumber}/send`, { method: 'POST' }); },
    onSuccess: () => { setConfirm(false); onChanged(); },
  });
  const updC = (i: number, patch: Partial<Clause>) => setClauses((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const updS = (i: number, patch: Partial<SignerRow>) => setSigners((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const unfinished = clauses.filter((c) => hasPlaceholder(c.body)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2"><AgreementBadge status="DRAFT" />{dirty && <Badge tone="warn">Unsaved changes</Badge>}</div>
      <p className="rounded-control bg-stat px-4 py-3 text-[13px] text-ink-2">Template clauses are a generic starting point, not legal advice. Review and edit every clause (and replace any <code>[BRACKETED]</code> text) before sending. Once sent, the content is locked.</p>

      <Card className="p-6" aria-labelledby="signers-h">
        <h2 id="signers-h" className="mb-4 text-lg font-semibold">Signers</h2>
        <div className="flex flex-col gap-3">{signers.map((s, i) => (
          <div key={i} className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-3">
            <Field label="Role">{(id) => <Select id={id} value={s.role} onChange={(e) => updS(i, { role: e.target.value as Signer['role'] })}><option value="FREELANCER">You (freelancer)</option><option value="CLIENT">Client</option><option value="WITNESS">Witness</option></Select>}</Field>
            <Field label="Name">{(id) => <Input id={id} value={s.name} onChange={(e) => updS(i, { name: e.target.value })} />}</Field>
            <Field label="Email">{(id) => <Input id={id} type="email" value={s.email} onChange={(e) => updS(i, { email: e.target.value })} />}</Field>
            <div className="flex items-end gap-2"><div className="w-20"><Field label="Order">{(id) => <Input id={id} inputMode="numeric" value={String(s.signingOrder)} onChange={(e) => updS(i, { signingOrder: Math.max(1, Number(e.target.value) || 1) })} />}</Field></div>
              <Button variant="ghost" aria-label={`Remove signer ${i + 1}`} onClick={() => setSigners((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button></div>
          </div>))}
        </div>
        <div className="mt-4"><Button onClick={() => setSigners((a) => [...a, { role: 'CLIENT', name: '', email: '', signingOrder: a.length + 1 }])}><Plus size={16} aria-hidden="true" />Add signer</Button></div>
      </Card>

      {clauses.map((c, i) => (
        <Card key={i} className="p-6" aria-label={`Clause ${i + 1}`}>
          <div className="mb-3 flex items-end gap-2"><div className="min-w-0 flex-1"><Field label={`Clause ${i + 1} heading`}>{(id) => <Input id={id} value={c.heading} onChange={(e) => updC(i, { heading: e.target.value })} />}</Field></div>
            <Button variant="ghost" aria-label={`Remove clause ${i + 1}`} onClick={() => setClauses((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button></div>
          <Field label="Text">{(id) => <Textarea id={id} rows={4} value={c.body} onChange={(e) => updC(i, { body: e.target.value })} />}</Field>
        </Card>))}
      <div><Button onClick={() => setClauses((a) => [...a, { heading: 'New clause', body: '' }])}><Plus size={16} aria-hidden="true" />Add clause</Button></div>

      <ErrorNote error={save.error} />
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-card border border-line bg-card/95 p-3 shadow-[var(--cast-stock-lift)] backdrop-blur">
        {unfinished > 0 && <span className="mr-auto text-sm text-warn-ink" role="status">Bracketed placeholders remain in {unfinished} {unfinished === 1 ? 'clause' : 'clauses'}</span>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
        <Button variant="primary" onClick={() => { send.reset(); setConfirm(true); }}>Send for signature…</Button>
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Send for signature"
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" onClick={() => send.mutate()} disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Lock and send'}</Button></>}>
        <p className="text-ink-2">This saves the draft and <strong>locks the clauses and signer list</strong>, recording a fingerprint of exactly what was sent. Later changes need an amendment. Client signers sign in the portal; you sign here.</p>
        <div className="mt-4"><WhoSees clientId={clientId} what="this agreement" /></div>
        {problems(send.error) && <ul role="alert" className="mt-4 list-disc rounded-control bg-danger-soft py-2 pl-8 pr-3 text-sm text-danger">{problems(send.error)!.map((x) => <li key={x}>{x}</li>)}</ul>}
        <div className="mt-3"><ErrorNote error={send.error && !problems(send.error) ? send.error : null} /></div>
      </Dialog>
    </div>
  );
}

function SignDialog({ agreementId, n, signer, onClose, onDone }: { agreementId: string; n: number; signer: Signer; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(signer.name);
  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const m = useMutation({ mutationFn: () => api(`/agreements/${agreementId}/versions/${n}/sign`, { body: { signerId: signer.id, typedName: name, agree, signature: sig } }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} title="Sign this agreement"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="sign" disabled={m.isPending || !agree || !sig || name.trim().length < 2}>{m.isPending ? 'Signing…' : 'Sign'}</Button></>}>
      <form id="sign" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Your full name" hint={`Exactly as on the agreement: ${signer.name}`}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="flex flex-col gap-1.5"><span className="text-sm font-medium text-ink-2">Your signature</span><SignaturePad name={name} onChange={setSig} /></div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to be bound by this agreement.</span></label>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function RecordDialog({ agreementId, n, signer, type, onClose, onDone }: { agreementId: string; n: number; signer: Signer; type: 'SIGNED' | 'DECLINED'; onClose: () => void; onDone: () => void }) {
  const [evidence, setEvidence] = useState('');
  const [key] = useState(() => crypto.randomUUID()); // a retry of this same submission can never record twice
  const m = useMutation({ mutationFn: () => api(`/agreements/${agreementId}/versions/${n}/events`, { body: { type, signerId: signer.id, evidence }, headers: { 'Idempotency-Key': key } }), onSuccess: onDone });
  const signed = type === 'SIGNED';
  return (
    <Dialog open onClose={onClose} title={signed ? `Record ${signer.name}’s signature` : `Record that ${signer.name} declined`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="record" disabled={m.isPending || evidence.trim().length < 3}>{m.isPending ? 'Recording…' : 'Record'}</Button></>}>
      <form id="record" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={signed ? 'How do you know it was signed?' : 'Reason given'} hint={signed ? 'E.g. “Signed PDF received by email on 12 Nov”. This is kept as evidence.' : undefined}>
          {(id, d) => <Textarea id={id} aria-describedby={d} required value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
        </Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function VoidDialog({ open, agreementId, onClose, onDone }: { open: boolean; agreementId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api(`/agreements/${agreementId}/void`, { body: { reason } }), onSuccess: onDone });
  return (
    <Dialog open={open} onClose={onClose} title="Void this agreement?"
      footer={<><Button onClick={onClose}>Keep agreement</Button><Button variant="primary" type="submit" form="void" disabled={m.isPending || reason.trim().length < 3}>Void agreement</Button></>}>
      <form id="void" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">The agreement stays on record but can no longer be signed. A signed agreement cannot be voided; it is changed by an amendment.</p>
        <Field label="Reason">{(id) => <Textarea id={id} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
