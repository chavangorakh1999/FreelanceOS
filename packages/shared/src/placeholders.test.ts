import { describe, expect, it } from 'vitest';
import { hasPlaceholder, placeholderTitles } from './placeholders';

describe('placeholders', () => {
  it('catches both shouting and sentence-case guidance', () => {
    expect(hasPlaceholder('governed by [GOVERNING LAW / JURISDICTION].')).toBe(true);
    expect(hasPlaceholder('[Describe who owns the deliverables.]')).toBe(true);
    expect(hasPlaceholder('Intro text. [Summarise the problem]')).toBe(true);
  });
  it('leaves ordinary brackets alone', () => {
    expect(hasPlaceholder('See reference [1] and [sic] and [a]')).toBe(false);
    expect(hasPlaceholder('Total (incl. GST) is due')).toBe(false);
    expect(hasPlaceholder('')).toBe(false);
    expect(hasPlaceholder(null)).toBe(false);
  });
  it('lists the sections that still need work', () => {
    expect(placeholderTitles([{ title: 'Scope', body: '[Describe scope]' }, { title: 'Timeline', body: 'Done' }])).toEqual(['Scope']);
  });
});
