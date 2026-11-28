/** 1:30, 1.5, 1.5h, 90m, 90 (minutes when over 12) → minutes. */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,2}):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2})\s*m)?$/))) return Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0);
  if ((m = t.match(/^(\d+)\s*m(in)?$/))) return Number(m[1]);
  if ((m = t.match(/^\d+(?:\.\d+)?$/))) { const n = Number(t); return n > 12 ? Math.round(n) : Math.round(n * 60); }
  return null;
}
export const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
