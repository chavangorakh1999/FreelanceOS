import { indianFinancialYear } from '@freelanceos/shared';

/** "Today" as a calendar date in the workspace's timezone, as a UTC-midnight Date (how @db.Date values are handled). */
export function todayIn(timeZone: string, now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

export const ymd = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

/** First day of the Indian financial year (1 April) that contains `date`. */
export function financialYearStart(date: Date, timeZone: string): Date {
  const [yy] = indianFinancialYear(new Date(`${ymd(date)}T12:00:00Z`), timeZone).split('-');
  return new Date(`20${yy}-04-01T00:00:00Z`);
}
