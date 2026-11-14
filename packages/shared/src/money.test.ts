import { describe, expect, it } from 'vitest';
import { add, divRound, formatMoney, money, parseMoney, percentOf, splitEvenly, sub, toDecimalString } from './money';

describe('money', () => {
  it('parses and prints decimals exactly', () => {
    expect(parseMoney('1500.50', 'INR').amountMinor).toBe(150050n);
    expect(toDecimalString(parseMoney('0.07', 'INR'))).toBe('0.07');
    expect(toDecimalString(parseMoney('-12.5', 'USD'))).toBe('-12.50');
    expect(toDecimalString(money(5000n, 'JPY'))).toBe('5000');
  });

  it('rejects too many decimal places and unknown currencies', () => {
    expect(() => parseMoney('1.005', 'INR')).toThrow();
    expect(() => money(1n, 'XXX')).toThrow();
  });

  it('avoids float drift', () => {
    const a = parseMoney('0.10', 'INR');
    const b = parseMoney('0.20', 'INR');
    expect(toDecimalString(add(a, b))).toBe('0.30');
  });

  it('refuses mixed currencies', () => {
    expect(() => add(money(1n, 'INR'), money(1n, 'USD'))).toThrow(/mismatch/);
  });

  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });

  it('applies basis-point percentages', () => {
    expect(percentOf(parseMoney('2000.00', 'INR'), 1800).amountMinor).toBe(36000n);
    // 18% of 0.05 = 0.009 -> rounds to 0.01
    expect(percentOf(parseMoney('0.05', 'INR'), 1800).amountMinor).toBe(1n);
  });

  it('splits so parts sum to the whole', () => {
    const parts = splitEvenly(parseMoney('100.00', 'INR'), 3);
    expect(parts.map((p) => toDecimalString(p))).toEqual(['33.34', '33.33', '33.33']);
    expect(parts.reduce((s, p) => s + p.amountMinor, 0n)).toBe(10000n);
  });

  it('formats with Indian digit grouping', () => {
    expect(formatMoney(parseMoney('236000', 'INR'))).toBe('₹2,36,000.00');
    expect(sub(money(1n, 'INR'), money(1n, 'INR')).amountMinor).toBe(0n);
  });
});
