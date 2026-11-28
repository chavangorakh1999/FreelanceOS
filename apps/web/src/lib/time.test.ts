import { describe, expect, it } from 'vitest';
import { hm, parseDuration } from './time';

describe('durations people type', () => {
  it('reads hours and minutes in the usual ways', () => {
    expect(['1:30', '1.5', '1.5h', '1h 30m', '90m', '90 min', '90', '2', '0:05', '12'].map(parseDuration)).toEqual([90, 90, 90, 90, 90, 90, 90, 120, 5, 720]);
    expect(['', 'abc', '1:75', '-1'].map(parseDuration)).toEqual([null, null, null, null]);
  });
  it('shows minutes as h:mm', () => { expect([0, 5, 90, 605].map(hm)).toEqual(['0:00', '0:05', '1:30', '10:05']); });
});
