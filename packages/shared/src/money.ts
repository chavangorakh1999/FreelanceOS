/**
 * Money is always an integer count of minor units plus an ISO 4217 code.
 * No floating-point arithmetic is ever used for amounts (PRD Appendix B #16).
 */

export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  JPY: 0,
  KWD: 3,
};

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export function currencyExponent(currency: string): number {
  const exp = CURRENCY_EXPONENTS[currency];
  if (exp === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return exp;
}

export function money(amountMinor: bigint | number, currency: string): Money {
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) {
    throw new Error('Money amount must be a safe integer count of minor units');
  }
  currencyExponent(currency);
  return { amountMinor: BigInt(amountMinor), currency };
}

/** Parse a decimal string like "1500.50" into Money without floats. */
export function parseMoney(decimal: string, currency: string): Money {
  const exp = currencyExponent(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) throw new Error(`Invalid decimal amount: ${decimal}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > exp) {
    throw new Error(`${currency} allows at most ${exp} decimal places`);
  }
  const minor = BigInt(whole! + frac.padEnd(exp, '0'));
  return { amountMinor: sign ? -minor : minor, currency };
}

/** Render as a plain decimal string, e.g. 150050n INR -> "1500.50". */
export function toDecimalString(m: Money): string {
  const exp = currencyExponent(m.currency);
  const neg = m.amountMinor < 0n;
  const abs = (neg ? -m.amountMinor : m.amountMinor).toString().padStart(exp + 1, '0');
  const whole = abs.slice(0, abs.length - exp);
  const frac = exp === 0 ? '' : '.' + abs.slice(abs.length - exp);
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** Locale-aware display. Exact: formats from the decimal string, never a float. */
export function formatMoney(
  m: Money,
  opts: { locale?: string; showCode?: boolean } = {},
): string {
  const { locale = 'en-IN', showCode = false } = opts;
  const exp = currencyExponent(m.currency);
  const out = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(toDecimalString(m) as unknown as number);
  return showCode ? `${out} ${m.currency}` : out;
}

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export const zero = (currency: string): Money => money(0n, currency);
export const add = (a: Money, b: Money): Money => (assertSame(a, b), { ...a, amountMinor: a.amountMinor + b.amountMinor });
export const sub = (a: Money, b: Money): Money => (assertSame(a, b), { ...a, amountMinor: a.amountMinor - b.amountMinor });
export const negate = (a: Money): Money => ({ ...a, amountMinor: -a.amountMinor });
export const isZero = (a: Money): boolean => a.amountMinor === 0n;
export const compare = (a: Money, b: Money): -1 | 0 | 1 => {
  assertSame(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
};
export const min = (a: Money, b: Money): Money => (compare(a, b) <= 0 ? a : b);
export const sum = (currency: string, items: readonly Money[]): Money =>
  items.reduce((acc, i) => add(acc, i), zero(currency));

/** Integer division rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero');
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return neg ? -q : q;
}

/** Apply a rate in basis points (1800 = 18.00%) with explicit rounding. */
export function percentOf(m: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) throw new Error('Basis points must be an integer');
  return { ...m, amountMinor: divRound(m.amountMinor * BigInt(basisPoints), 10000n) };
}

/** Split an amount into n parts that sum exactly to the original (largest-remainder). */
export function splitEvenly(m: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('parts must be a positive integer');
  const n = BigInt(parts);
  const base = m.amountMinor / n;
  let remainder = m.amountMinor - base * n;
  const step = remainder < 0n ? -1n : 1n;
  return Array.from({ length: parts }, () => {
    const extra = remainder !== 0n ? step : 0n;
    remainder -= extra;
    return { ...m, amountMinor: base + extra };
  });
}
