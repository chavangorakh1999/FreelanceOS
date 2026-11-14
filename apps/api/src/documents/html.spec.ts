import { describe, expect, it } from 'vitest';
import { esc, renderAgreementHtml, renderProposalHtml } from './html';

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
