import { formatMoney, money } from '@freelanceos/shared';

/** Every piece of user-authored text goes through this before it enters the document HTML. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmt = (minor: bigint, currency: string, locale: string) => formatMoney(money(minor, currency), { locale });
const para = (text: string) => esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.5; color: #121212; font-variant-numeric: tabular-nums; }
  h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 13pt; margin: 22px 0 6px; break-after: avoid; }
  table, tr, .totals, .sig div { break-inside: avoid; }
  p { margin: 0 0 8px; }
  .meta { color: #5f5f5f; margin-bottom: 18px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 6px; background: #f0f0f0; font-size: 9pt; font-weight: 600; margin-left: 8px; vertical-align: middle; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
  th { text-align: left; background: #f0f0f0; font-weight: 600; padding: 7px 10px; font-size: 9.5pt; }
  td { padding: 8px 10px; border-bottom: 1px solid #ececec; vertical-align: top; }
  .r { text-align: right; }
  .totals { margin-left: auto; width: 260px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { border-top: 1px solid #121212; font-weight: 700; font-size: 12pt; margin-top: 4px; padding-top: 6px; }
  .sig { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .sig div { border-top: 1px solid #121212; padding-top: 6px; font-size: 9.5pt; }
  .foot { margin-top: 32px; color: #5f5f5f; font-size: 8.5pt; border-top: 1px solid #ececec; padding-top: 8px; }
  .draft { color: #92400e; background: #fef3e2; }
`;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

export interface ProposalDoc {
  number: string; title: string; versionNumber: number; status: string; currency: string; locale: string;
  workspaceName: string; clientName: string; validUntil: string | null; pricingModel: string; summary: string | null;
  sections: { title: string; body: string }[];
  lineItems: { description: string; quantity: string; unitLabel: string; unitRateMinor: bigint; discountBps: number; taxBps: number; netMinor: bigint; taxMinor: bigint }[];
  paymentTerms: { label: string; kind: string; percentageBps: number | null; amountMinor: bigint | null; dueInDays: number | null }[];
  subtotalMinor: bigint; discountMinor: bigint; taxMinor: bigint; totalMinor: bigint;
}

export function renderProposalHtml(d: ProposalDoc): string {
  const m = (v: bigint) => esc(fmt(v, d.currency, d.locale));
  const draft = d.status === 'DRAFT' ? '<span class="badge draft">DRAFT</span>' : '';
  const terms = d.paymentTerms.map((t) => {
    const how = t.percentageBps != null ? `${(t.percentageBps / 100).toFixed(2).replace(/\.00$/, '')}%` : t.amountMinor != null ? m(t.amountMinor) : '';
    const due = t.dueInDays != null ? `within ${t.dueInDays} days` : '';
    return `<tr><td>${esc(t.label)}</td><td class="r">${esc([how, due].filter(Boolean).join(' · '))}</td></tr>`;
  }).join('');
  return page(`${d.number} v${d.versionNumber}`, `
    <h1>${esc(d.title)}${draft}</h1>
    <div class="meta">${esc(d.number)} · Version ${d.versionNumber} · Prepared by ${esc(d.workspaceName)} for ${esc(d.clientName)}${d.validUntil ? ` · Valid until ${esc(d.validUntil)}` : ''}</div>
    ${d.summary ? para(d.summary) : ''}
    ${d.sections.map((s) => `<h2>${esc(s.title)}</h2>${para(s.body)}`).join('')}
    <h2>Pricing <span class="meta">(${esc(d.pricingModel.replace(/_/g, ' ').toLowerCase())})</span></h2>
    <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
      ${d.lineItems.map((l) => `<tr><td>${esc(l.description)}${l.discountBps ? `<br><span class="meta">Discount ${(l.discountBps / 100).toFixed(2)}%</span>` : ''}</td><td class="r">${esc(l.quantity)} ${esc(l.unitLabel)}</td><td class="r">${m(l.unitRateMinor)}</td><td class="r">${m(l.netMinor)}</td></tr>`).join('')}
    </tbody></table>
    <div class="totals">
      <div><span>Subtotal</span><span>${m(d.subtotalMinor)}</span></div>
      ${d.discountMinor > 0n ? `<div><span>Discounts</span><span>−${m(d.discountMinor)}</span></div>` : ''}
      <div><span>Tax</span><span>${m(d.taxMinor)}</span></div>
      <div class="grand"><span>Total</span><span>${m(d.totalMinor)}</span></div>
    </div>
    ${terms ? `<h2>Payment terms</h2><table><tbody>${terms}</tbody></table>` : ''}
    <div class="foot">Prepared with FreelanceOS. This is a commercial proposal, not a contract; any agreement takes effect only when signed by both parties.</div>`);
}

export interface AgreementDoc {
  number: string; title: string; versionNumber: number; status: string; workspaceName: string; clientName: string;
  contentHash: string | null; sentAt: string | null;
  clauses: { heading: string; body: string }[];
  signers: { role: string; name: string; email: string; status: string; signedAt: string | null }[];
}

export function renderAgreementHtml(d: AgreementDoc): string {
  const draft = d.status === 'DRAFT' ? '<span class="badge draft">DRAFT</span>' : '';
  return page(`${d.number} v${d.versionNumber}`, `
    <h1>${esc(d.title)}${draft}</h1>
    <div class="meta">${esc(d.number)} · Version ${d.versionNumber} · ${esc(d.workspaceName)} and ${esc(d.clientName)}</div>
    ${d.clauses.map((c, i) => `<h2>${i + 1}. ${esc(c.heading)}</h2>${para(c.body)}`).join('')}
    <h2>Signatures</h2>
    <div class="sig">${d.signers.map((s) => `<div><strong>${esc(s.name)}</strong><br>${esc(s.role.toLowerCase())} · ${esc(s.email)}<br>${s.status === 'SIGNED' ? `Signed ${esc(s.signedAt ?? '')}` : esc(s.status.toLowerCase())}</div>`).join('')}</div>
    <div class="foot">${d.contentHash ? `Content fingerprint (SHA-256): ${esc(d.contentHash)}<br>` : ''}Generated by FreelanceOS. A signature recorded in the system is evidence of the signing event; this document does not itself guarantee legal enforceability.</div>`);
}
