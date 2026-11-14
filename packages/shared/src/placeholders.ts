/**
 * Template guidance is written in square brackets, e.g. "[Describe what is included.]" or "[GOVERNING LAW]".
 * A document must not be shared or sent while any remains. A bracket counts as guidance when it starts with a
 * capital letter and is at least three characters, so ordinary references such as "[1]" or "[sic]" are left alone.
 */
const PLACEHOLDER = /\[[A-Z][^\]\n]{2,}\]/;

export const hasPlaceholder = (text: string | null | undefined): boolean => PLACEHOLDER.test(text ?? '');

/** Titles of the items whose text still contains guidance, for an actionable error message. */
export const placeholderTitles = (items: readonly { title: string; body: string }[]): string[] =>
  items.filter((i) => hasPlaceholder(i.body)).map((i) => i.title);
