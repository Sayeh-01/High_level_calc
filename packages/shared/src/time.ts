// Timezone helpers built on Intl only (no tz library). All instants are epoch milliseconds.

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

export function toZoned(instant: number, tz: string): LocalDateTime & { second: number; weekday: number } {
  const parts: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { year: parts.year, month: parts.month, day: parts.day, hour, minute: parts.minute, second: parts.second, weekday };
}

/** Offset of tz from UTC at the given instant, in ms (Cairo summer = +3h). */
export function tzOffset(instant: number, tz: string): number {
  const z = toZoned(instant, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall clock in tz shows the given local time. Gap times move forward. */
export function fromZoned(local: LocalDateTime, tz: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const off1 = tzOffset(guess - 0, tz);
  let utc = guess - off1;
  const off2 = tzOffset(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

export function startOfLocalDay(instant: number, tz: string): number {
  const z = toZoned(instant, tz);
  return fromZoned({ year: z.year, month: z.month, day: z.day, hour: 0, minute: 0 }, tz);
}

export function addLocalDays(instant: number, days: number, tz: string): number {
  const z = toZoned(instant, tz);
  const d = new Date(Date.UTC(z.year, z.month - 1, z.day + days));
  return fromZoned({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: z.hour, minute: z.minute }, tz);
}

export const DAY_MS = 86_400_000;
