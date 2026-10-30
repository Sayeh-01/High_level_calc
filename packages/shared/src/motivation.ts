import { toZoned } from './time';

/** Calendar day of an instant in a timezone, as YYYY-MM-DD. */
export function localDayKey(instant: number, tz: string): string {
  const z = toZoned(instant, tz);
  return `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;
}

function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Consecutive local days with at least one activity, ending today — or yesterday, so a streak isn't lost before the
 * day is over. Days are counted in the group's timezone.
 */
export function computeStreak(instants: number[], tz: string, now: number): number {
  const days = new Set(instants.map((i) => localDayKey(i, tz)));
  let key = localDayKey(now, tz);
  if (!days.has(key)) key = prevDay(key);
  let n = 0;
  while (days.has(key)) {
    n++;
    key = prevDay(key);
  }
  return n;
}
