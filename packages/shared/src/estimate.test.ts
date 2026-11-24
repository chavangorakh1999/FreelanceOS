import { describe, expect, it } from 'vitest';
import { calculateInvoice } from './invoice';
import { calculateEstimate, estimatePhases, planPayments, ESTIMATE_CATALOG, ESTIMATE_DEFAULTS, ESTIMATE_SOURCES, ESTIMATE_TEMPLATES, EstimateInput, estimateToProposalLines } from './estimate';
import { parseMoney, toDecimalString } from './money';

const base = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  currency: 'USD', rate: '45', basis: 'expected', mobile: 'cross', lines: [], qaBps: 0, pmBps: 0, contingencyBps: 0, discount: { kind: 'none' }, taxBps: 0, ...over,
});
const usd = (m: { amountMinor: bigint; currency: string }) => toDecimalString(m as never);

describe('estimates', () => {
  it('prices hours times rate: 20 hours at $45 is $900', () => {
    const r = calculateEstimate(base({ lines: [{ name: 'Plain website', qty: 1, hoursEach: 20 }] }));
    expect(r.totalHours).toBe(20);
    expect(usd(r.gross)).toBe('900.00');
    expect(usd(r.total)).toBe('900.00');
  });

  it('adds a feature: plus a 10-hour payment gateway is 30 hours, $1,350', () => {
    const r = calculateEstimate(base({ lines: [{ name: 'Website', qty: 1, hoursEach: 20 }, { itemId: 'payments', qty: 1, hoursEach: 10 }] }));
    expect(r.totalHours).toBe(30);
    expect(usd(r.total)).toBe('1350.00');
  });

  it('uses the researched figure by basis: low, PERT expected, high', () => {
    const one = (basis: 'low' | 'expected' | 'high') => calculateEstimate(base({ basis, lines: [{ itemId: 'payments', qty: 1 }] })).totalHours;
    expect(one('low')).toBe(10);
    expect(one('expected')).toBe(21.5); // (10 + 4×20 + 40) / 6 = 21.67, kept to the half hour
    expect(one('high')).toBe(40);
  });

  it('counts units and scales mobile client work for two native apps only', () => {
    const lines = [{ itemId: 'app-screen', qty: 8 }, { itemId: 'admin', qty: 1 }];
    const cross = calculateEstimate(base({ basis: 'low', lines }));
    const native = calculateEstimate(base({ basis: 'low', lines, mobile: 'two-native' }));
    expect(cross.lines[0]!.hours).toBe(32);
    expect(native.lines[0]!.hours).toBe(52); // 4 × 1.65 = 6.6, kept as 6.5 per screen, × 8
    expect(native.lines[1]!.hours).toBe(cross.lines[1]!.hours); // the admin panel is built once either way
  });

  it('adds testing and management on the build, contingency on everything', () => {
    const r = calculateEstimate(base({ lines: [{ name: 'Build', qty: 1, hoursEach: 100 }], ...ESTIMATE_DEFAULTS }));
    expect([r.buildHours, r.qaHours, r.pmHours, r.contingencyHours]).toEqual([100, 20, 10, 19.5]);
    expect(r.totalHours).toBe(149.5);
  });

  it('discounts the whole amount by a percentage or a fixed sum', () => {
    const lines = [{ name: 'Build', qty: 1, hoursEach: 30 }];
    const pct = calculateEstimate(base({ lines, discount: { kind: 'percent', bps: 1000 } }));
    expect([usd(pct.gross), usd(pct.discount), usd(pct.net)]).toEqual(['1350.00', '135.00', '1215.00']);
    expect(usd(pct.effectiveRate)).toBe('40.50');
    const amt = calculateEstimate(base({ lines, discount: { kind: 'amount', amount: '150' } }));
    expect(usd(amt.net)).toBe('1200.00');
    expect(usd(calculateEstimate(base({ lines, discount: { kind: 'amount', amount: '99999' } })).net)).toBe('0.00');
  });

  it('discounts the hourly rate: 30 hours billed at $40 instead of $45', () => {
    const r = calculateEstimate(base({ lines: [{ name: 'Build', qty: 1, hoursEach: 30 }], discount: { kind: 'rate', rate: '40' } }));
    expect([usd(r.gross), usd(r.discount), usd(r.net), usd(r.billedRate)]).toEqual(['1350.00', '150.00', '1200.00', '40.00']);
    const higher = calculateEstimate(base({ lines: [{ name: 'Build', qty: 1, hoursEach: 30 }], discount: { kind: 'rate', rate: '50' } }));
    expect(usd(higher.discount)).toBe('0.00');
  });

  it('adds tax after the discount and gives a low to high range', () => {
    const r = calculateEstimate(base({ lines: [{ itemId: 'payments', qty: 1 }], discount: { kind: 'percent', bps: 1000 }, taxBps: 1800 }));
    expect(usd(r.tax)).toBe(usd({ amountMinor: (r.net.amountMinor * 18n + 50n) / 100n, currency: 'USD' }));
    expect(r.range.lowHours).toBe(10);
    expect(r.range.highHours).toBe(40);
  });

  it('becomes proposal lines that total exactly the same', () => {
    const input = base({ ...ESTIMATE_DEFAULTS, lines: ESTIMATE_TEMPLATES[0]!.items.map((i) => ({ itemId: i.id, qty: i.qty ?? 1 })), discount: { kind: 'rate', rate: '40' }, taxBps: 1800 });
    const r = calculateEstimate(input);
    const lines = estimateToProposalLines(input, r);
    const inv = calculateInvoice('USD', lines.map((l) => ({ ...l, unitRate: parseMoney(l.unitRate, 'USD') })));
    expect(inv.total.amountMinor).toBe(r.total.amountMinor);
    expect(lines.at(-1)!.description).toBe('Contingency for unknowns');
  });

  it('every catalogue item is ordered, sourced, and its sources exist', () => {
    for (const i of ESTIMATE_CATALOG) {
      expect(i.low).toBeLessThanOrEqual(i.likely);
      expect(i.likely).toBeLessThanOrEqual(i.high);
      expect(i.sources.length).toBeGreaterThan(0);
      for (const s of i.sources) expect(ESTIMATE_SOURCES[s]).toBeDefined();
    }
    for (const t of ESTIMATE_TEMPLATES) for (const x of t.items) expect(ESTIMATE_CATALOG.some((i) => i.id === x.id)).toBe(true);
  });

  it('works in currencies without decimals', () => {
    const r = calculateEstimate(base({ currency: 'JPY', rate: '6500', lines: [{ name: 'x', qty: 1, hoursEach: 2.5 }] }));
    expect(toDecimalString(r.total)).toBe('16250');
  });

  describe('payment plans', () => {
    const r = calculateEstimate(base({ rate: '45', lines: [{ itemId: 'discovery', qty: 1, hoursEach: 10 }, { itemId: 'site-base', qty: 1, hoursEach: 40 }, { itemId: 'payments', qty: 1, hoursEach: 40 }, { itemId: 'deploy-web', qty: 1, hoursEach: 7 }] }));
    const sumBps = (t: { percentageBps?: number }[]) => t.reduce((s, x) => s + (x.percentageBps ?? 0), 0);
    const sumAmt = (a: ({ amountMinor: bigint } | null)[]) => a.reduce((s, x) => s + (x?.amountMinor ?? 0n), 0n);

    it('deposit and completion is a fixed price split two ways', () => {
      const p = planPayments({ kind: 'deposit', depositBps: 3000 }, r);
      expect(p.pricingModel).toBe('FIXED');
      expect(p.terms.map((t) => [t.kind, t.percentageBps])).toEqual([['UPFRONT', 3000], ['ON_COMPLETION', 7000]]);
      expect(sumAmt(p.amounts)).toBe(r.total.amountMinor);
    });

    it('milestones follow the phases, sized by hours, and total exactly 100%', () => {
      // Launch (7 h of 97) is under 10%, so it joins the last phase.
      expect(estimatePhases(r).map((x) => [x.label, x.hours])).toEqual([['Planning and design approved', 10], ['Website delivered', 40], ['Accounts and payments delivered and launch', 47]]);
      const p = planPayments({ kind: 'milestone', depositBps: 2000, dueInDays: 7 }, r);
      expect(p.pricingModel).toBe('MILESTONE');
      expect(sumBps(p.terms)).toBe(10_000);
      expect(p.terms[0]).toEqual({ label: 'Deposit to start', kind: 'UPFRONT', percentageBps: 2000 });
      expect(p.terms.at(-1)!.kind).toBe('ON_COMPLETION');
      expect(p.terms[2]!.percentageBps).toBe(3299); // 8,000 × 40 ÷ 97, largest remainder
      expect(sumAmt(p.amounts)).toBe(r.total.amountMinor);
    });

    it('monthly payments are equal, one per month, and total exactly', () => {
      const p = planPayments({ kind: 'monthly', months: 3 }, r);
      expect(p.terms.map((t) => [t.percentageBps, t.dueInDays])).toEqual([[3334, undefined], [3333, 30], [3333, 60]]);
      expect(sumAmt(p.amounts)).toBe(r.total.amountMinor);
      expect(planPayments({ kind: 'monthly', months: 40 }, r).terms).toHaveLength(12);
    });

    it('hourly bills hours worked, with the estimate as a forecast', () => {
      const p = planPayments({ kind: 'hourly', cycle: 'monthly', dueInDays: 15 }, r);
      expect(p.pricingModel).toBe('HOURLY');
      expect(p.terms).toEqual([{ label: 'Invoiced every month for hours worked', kind: 'NET_DAYS', dueInDays: 15 }]);
      expect(p.description).toContain('45.00 USD');
      expect(p.amounts).toEqual([null]);
    });
  });
});
