import { describe, expect, it } from 'vitest';
import { describeAction, fmtMoney, trimDecimal } from './format';

describe('fmtMoney', () => {
  it('renders minor units exactly with Indian grouping', () => {
    expect(fmtMoney({ amountMinor: '23600050', currency: 'INR' })).toBe('₹2,36,000.50');
    expect(fmtMoney({ amountMinor: '5', currency: 'INR' })).toBe('₹0.05');
  });

  it('is exact beyond 2^53 (no float round-trip)', () => {
    expect(fmtMoney({ amountMinor: '900719925474099312', currency: 'INR' })).toContain('9,00,71,99,25,47,40,993.12');
  });

  it('respects currency precision', () => {
    expect(fmtMoney({ amountMinor: '5000', currency: 'JPY' }, 'en-US')).toBe('¥5,000');
    expect(fmtMoney({ amountMinor: '5000', currency: 'USD' }, 'en-US')).toBe('$50.00');
  });
});

describe('describeAction', () => {
  it('turns audit actions into readable sentences', () => {
    expect(describeAction('engagement.stage_changed', { toName: 'Proposal' })).toBe('Moved to Proposal');
    expect(describeAction('client.created', { name: 'Acme' })).toBe('Client created: Acme');
  });
  it('falls back to the raw action for unknown events', () => {
    expect(describeAction('something.new', null)).toBe('something.new');
  });
});

describe('trimDecimal', () => {
  it('keeps whole numbers whole and trims only after the point', () => {
    expect(['90', '10', '100', '90.0000', '2.5000', '0.5', '0', '0.0000'].map(trimDecimal)).toEqual(['90', '10', '100', '90', '2.5', '0.5', '0', '0']);
  });
});
