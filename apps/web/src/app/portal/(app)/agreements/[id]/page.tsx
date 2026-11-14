'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Hourglass } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AgreementBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Spinner, Textarea } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { papi, PAgreementDetail, portalDownload } from '@/lib/portal-api';

export default function PortalAgreementPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'agreement', id], queryFn: () => papi<PAgreementDetail>(`/portal/agreements/${id}`) });
  const [typed, setTyped] = useState('');
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['portal'] }); };
  const sign = useMutation({ mutationFn: () => papi(`/portal/agreements/${id}/sign`, { body: { typedName: typed, agree } }), onSuccess: refresh });
  const decline = useMutation({ mutationFn: () => papi(`/portal/agreements/${id}/decline`, { body: { reason } }), onSuccess: () => { setDeclining(false); refresh(); } });

  // Opening the document is recorded once, quietly, so the sender knows it was seen.
  const opened = q.data?.id;
  useEffect(() => { if (opened) void papi(`/portal/agreements/${opened}/viewed`, { method: 'POST' }).catch(() => undefined); }, [opened]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Agreement not found" /><ErrorNote error={q.error} /><Link href="/portal/agreements" className="text-accent hover:underline">Back to agreements</Link></>;
  const a = q.data;

  return (
    <>
      <title>{`${a.title}, Client portal`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/portal/agreements" className="hover:underline">Agreements</Link></nav>
      <PageHeader title={a.title} subtitle={`${a.number}${a.expiresAt ? `, sign by ${fmtDate(a.expiresAt)}` : ''}`}
        actions={<div className="flex flex-wrap items-center gap-2"><AgreementBadge status={a.status} /><Button onClick={() => void portalDownload(`/portal/agreements/${id}/pdf`, `${a.number}.pdf`)}><Download size={16} aria-hidden="true" />PDF</Button></div>} />

      {a.canSign && (
        <Card className="flex flex-col gap-4 border-accent/30 bg-accent-soft/40 p-5 sm:p-6" aria-labelledby="sign-h">
          <div><h2 id="sign-h" className="text-lg font-semibold">Sign this agreement</h2><p className="text-ink-2">Read the terms below, then type your full name to sign. We record your name, the time and your network address.</p></div>
          <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); sign.mutate(); }}>
            <Field label="Type your full name" hint={`Exactly as written: ${a.you?.name}`}>{(fid, d) => <Input id={fid} aria-describedby={d} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I have read this agreement and agree to be bound by it.</span></label>
            <ErrorNote error={sign.error} />
            <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={sign.isPending || !agree || typed.trim().length < 2}>Sign agreement</Button><Button onClick={() => setDeclining(true)}>Decline</Button></div>
          </form>
        </Card>
      )}
      {!a.canSign && a.waitingFor && a.you?.status === 'PENDING' && <p className="flex items-center gap-2 rounded-control bg-stat px-4 py-3 text-ink-2"><Hourglass size={16} aria-hidden="true" />Waiting for {a.waitingFor} to sign first. You’ll get an email when it’s your turn.</p>}
      {a.you?.status === 'SIGNED' && <p className="flex items-center gap-2 rounded-control bg-accent-soft px-4 py-3 text-accent-ink"><CheckCircle2 size={16} aria-hidden="true" />You signed this agreement.</p>}

      <Card className="p-5 sm:p-6" aria-labelledby="terms-h">
        <h2 id="terms-h" className="mb-4 text-lg font-semibold">Terms</h2>
        <ol className="flex flex-col gap-5">
          {a.clauses.map((c, i) => <li key={c.id}><h3 className="font-semibold">{i + 1}. {c.heading}</h3><p className="mt-1 whitespace-pre-wrap text-ink-2">{c.body}</p></li>)}
        </ol>
        {a.contentHash && <p className="mt-6 break-all text-[12px] text-muted">Document fingerprint (SHA-256): {a.contentHash}</p>}
      </Card>

      <Card className="p-5 sm:p-6" aria-labelledby="sg-h">
        <h2 id="sg-h" className="mb-3 text-lg font-semibold">Signatures</h2>
        <ul className="divide-y divide-line">
          {a.signers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span>{s.name}{s.isYou && <span className="text-muted"> (you)</span>}<span className="text-[13px] text-muted">, {s.role.toLowerCase()}</span></span>
              {s.status === 'SIGNED' ? <Badge tone="success">Signed {s.signedAt ? fmtDateTime(s.signedAt) : ''}</Badge> : s.status === 'DECLINED' ? <Badge tone="danger">Declined</Badge> : <Badge tone="warn">Waiting</Badge>}</li>
          ))}
        </ul>
      </Card>

      <Dialog open={declining} onClose={() => setDeclining(false)} title="Decline this agreement"
        footer={<><Button onClick={() => setDeclining(false)}>Cancel</Button><Button variant="danger" disabled={decline.isPending || reason.trim().length < 3} onClick={() => decline.mutate()}>Decline agreement</Button></>}>
        <p className="mb-3 text-ink-2">This tells the sender you won’t sign this version. Let them know why.</p>
        <Field label="Reason">{(fid) => <Textarea id={fid} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="mt-3"><ErrorNote error={decline.error} /></div>
      </Dialog>
    </>
  );
}
