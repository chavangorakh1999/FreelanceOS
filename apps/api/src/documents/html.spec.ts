import { describe, expect, it } from 'vitest';
import { esc, InvoiceDoc, renderAgreementHtml, renderInvoiceHtml, renderProposalHtml } from './html';

describe('document HTML', () => {
  it('escapes every special character', () => {
    expect(esc(`<img src=x onerror="a()"> & 'q'`)).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;q&#39;');
    expect(esc(null)).toBe('');
  });

  it('never lets user text become markup', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderProposalHtml({
      number: 'PROP/26-27/0001', title: evil, versionNumber: 1, status: 'SHARED', currency: 'INR', locale: 'en-IN', workspaceName: evil, clientName: evil,
      validUntil: null, pricingModel: 'FIXED', summary: evil, sections: [{ title: evil, body: evil }],
      lineItems: [{ description: evil, quantity: '1', unitLabel: evil, unitRateMinor: 100n, discountBps: 0, taxBps: 0, netMinor: 100n, taxMinor: 0n }],
      paymentTerms: [{ label: evil, kind: 'UPFRONT', percentageBps: 10000, amountMinor: null, dueInDays: null }],
      subtotalMinor: 100n, discountMinor: 0n, taxMinor: 0n, totalMinor: 100n,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('formats money exactly and labels drafts', () => {
    const html = renderProposalHtml({
      number: 'P', title: 'T', versionNumber: 2, status: 'DRAFT', currency: 'INR', locale: 'en-IN', workspaceName: 'W', clientName: 'C', validUntil: '2026-12-01',
      pricingModel: 'TIME_AND_MATERIALS', summary: null, sections: [], lineItems: [], paymentTerms: [],
      subtotalMinor: 23600050n, discountMinor: 0n, taxMinor: 0n, totalMinor: 23600050n,
    });
    expect(html).toContain('₹2,36,000.50');
    expect(html).toContain('DRAFT');
    expect(html).toContain('time and materials');
  });

  it('renders agreement clauses, signers and the content fingerprint', () => {
    const html = renderAgreementHtml({
      number: 'AGR/26-27/0001', title: 'Agreement', versionNumber: 1, status: 'SIGNED', workspaceName: 'W', clientName: 'C', contentHash: 'abc123', sentAt: null,
      clauses: [{ heading: 'Services', body: 'Line one\n\nLine two' }],
      signers: [{ role: 'CLIENT', name: 'Priya', email: 'p@x.test', status: 'SIGNED', signedAt: '2026-11-12' }],
    });
    expect(html).toContain('1. Services');
    expect(html).toContain('<p>Line one</p><p>Line two</p>');
    expect(html).toContain('abc123');
    expect(html).toContain('Signed 2026-11-12');
  });
});

describe('invoice HTML', () => {
  const base: InvoiceDoc = {
    number: 'INV/26-27/0001', status: 'ISSUED', currency: 'INR', locale: 'en-IN', issueDate: '2026-11-14', dueDate: '2026-12-14',
    supplier: { name: 'Gorakh Studio', taxId: null, address: null }, billTo: { name: 'Northwind', taxId: null, address: null }, notes: null,
    lines: [{ description: 'Build', quantity: '1', unitLabel: 'unit', unitRateMinor: 10_000_000n, netMinor: 10_000_000n, taxBps: 1800 }],
    subtotalMinor: 10_000_000n, discountMinor: 0n, taxMinor: 1_800_000n, totalMinor: 11_800_000n, paidMinor: 10_000_000n, creditedMinor: 0n, outstandingMinor: 1_800_000n,
  };

  it('shows what is still owed on an issued invoice that has been partly settled', () => {
    const html = renderInvoiceHtml(base);
    expect(html).toContain('Balance due');
    expect(html).toContain('₹18,000.00');
    expect(html).toContain('₹1,18,000.00');
    expect(html).toContain('Settled');
  });

  it('omits settlement lines on a fresh invoice, marks drafts and voids, and never invents a balance for a draft', () => {
    const fresh = renderInvoiceHtml({ ...base, paidMinor: 0n, outstandingMinor: 11_800_000n });
    expect(fresh).not.toContain('Settled');
    expect(fresh).toContain('Balance due');
    expect(renderInvoiceHtml({ ...base, status: 'DRAFT', number: null })).not.toContain('Balance due');
    expect(renderInvoiceHtml({ ...base, status: 'DRAFT', number: null })).toContain('DRAFT');
    expect(renderInvoiceHtml({ ...base, status: 'VOID' })).toContain('VOID');
  });

  it('escapes hostile text in every user-supplied field', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderInvoiceHtml({ ...base, notes: evil, supplier: { name: evil, taxId: evil, address: evil }, billTo: { name: evil, taxId: evil, address: evil }, lines: [{ ...base.lines[0]!, description: evil, unitLabel: evil }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
