import { Money, parseMoney, toDecimalString } from '@freelanceos/shared';
import { DomainError } from './errors';

/** API money shape: amounts travel as strings so no float ever touches them. */
export interface MoneyJson {
  amountMinor: string;
  currency: string;
  decimal: string;
}

export const moneyToJson = (m: Money): MoneyJson => ({
  amountMinor: m.amountMinor.toString(),
  currency: m.currency,
  decimal: toDecimalString(m),
});

export function parseMoneyInput(decimal: string | undefined, currency: string): Money {
  try {
    return parseMoney(decimal ?? '0', currency);
  } catch (e) {
    throw new DomainError('INVALID_MONEY', (e as Error).message, 422);
  }
}
