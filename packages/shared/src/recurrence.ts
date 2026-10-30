import { fromZoned, toZoned, type LocalDateTime } from './time';

// A small RRULE subset (RFC 5545): FREQ, INTERVAL, COUNT, UNTIL, BYDAY (with optional ordinal for MONTHLY), BYMONTHDAY.
// Expansion happens on local wall-clock dates in the series' IANA timezone, so a weekly 21:00 event stays 21:00
// across DST changes.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof DAYS)[number];

export interface RRule {
  freq: Freq;
  interval: number;
  count?: number;
  until?: number; // instant
  byDay?: { day: number; nth?: number }[];
  byMonthDay?: number[];
}

export class RRuleError extends Error {}

export function parseRRule(input: string): RRule {
  const src = input.trim().replace(/^RRULE:/i, '');
  const parts = Object.fromEntries(
    src.split(';').filter(Boolean).map((kv) => {
      const [k, v = ''] = kv.split('=');
      return [k.toUpperCase(), v.toUpperCase()];
    }),
  );
  const freq = parts.FREQ as Freq;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new RRuleError(`unsupported FREQ: ${parts.FREQ}`);
  const rule: RRule = { freq, interval: parts.INTERVAL ? Number(parts.INTERVAL) : 1 };
  if (!Number.isInteger(rule.interval) || rule.interval < 1) throw new RRuleError('bad INTERVAL');
  if (parts.COUNT) rule.count = Number(parts.COUNT);
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(parts.UNTIL);
    if (!m) throw new RRuleError('bad UNTIL');
    rule.until = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? 59));
  }
  if (parts.BYDAY) {
    rule.byDay = parts.BYDAY.split(',').map((tok: string) => {
      const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok);
      if (!m) throw new RRuleError(`bad BYDAY: ${tok}`);
      return { day: DAYS.indexOf(m[2] as Weekday), nth: m[1] ? Number(m[1]) : undefined };
    });
  }
  if (parts.BYMONTHDAY) rule.byMonthDay = parts.BYMONTHDAY.split(',').map(Number);
  return rule;
}

export function isValidRRule(input: string): boolean {
  try {
    parseRRule(input);
    return true;
  } catch {
    return false;
  }
}

type DateOnly = { y: number; m: number; d: number };
const toUtcDate = (x: DateOnly) => new Date(Date.UTC(x.y, x.m - 1, x.d));
const fromUtcDate = (dt: Date): DateOnly => ({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
const addDays = (x: DateOnly, n: number) => fromUtcDate(new Date(Date.UTC(x.y, x.m - 1, x.d + n)));
const cmp = (a: DateOnly, b: DateOnly) => a.y - b.y || a.m - b.m || a.d - b.d;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function* candidateDates(rule: RRule, start: DateOnly): Generator<DateOnly> {
  const startWeekday = toUtcDate(start).getUTCDay();
  if (rule.freq === 'DAILY') {
    for (let i = 0; ; i += rule.interval) yield addDays(start, i);
  }
  if (rule.freq === 'WEEKLY') {
    const days = (rule.byDay?.map((b) => b.day) ?? [startWeekday]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    // weeks start on Monday (RFC default WKST=MO)
    const weekStart = addDays(start, -((startWeekday + 6) % 7));
    for (let w = 0; ; w += rule.interval) {
      const ws = addDays(weekStart, w * 7);
      for (const day of days) {
        const d = addDays(ws, (day + 6) % 7);
        if (cmp(d, start) >= 0) yield d;
      }
    }
  }
  if (rule.freq === 'MONTHLY') {
    for (let i = 0; ; i += rule.interval) {
      const y = start.y + Math.floor((start.m - 1 + i) / 12);
      const m = ((start.m - 1 + i) % 12) + 1;
      const dim = daysInMonth(y, m);
      const out: number[] = [];
      if (rule.byDay?.length) {
        for (const b of rule.byDay) {
          const matches: number[] = [];
          for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.day) matches.push(d);
          if (b.nth === undefined) out.push(...matches);
          else {
            const pick = b.nth > 0 ? matches[b.nth - 1] : matches[matches.length + b.nth];
            if (pick) out.push(pick);
          }
        }
      } else {
        for (const md of rule.byMonthDay ?? [start.d]) {
          const d = md < 0 ? dim + md + 1 : md;
          if (d >= 1 && d <= dim) out.push(d);
        }
      }
      for (const d of [...new Set(out)].sort((a, b) => a - b)) {
        const date = { y, m, d };
        if (cmp(date, start) >= 0) yield date;
      }
    }
  }
  if (rule.freq === 'YEARLY') {
    for (let i = 0; ; i += rule.interval) {
      const y = start.y + i;
      if (start.d <= daysInMonth(y, start.m)) yield { y, m: start.m, d: start.d };
    }
  }
}

/**
 * Occurrence start instants of a series that starts at `dtstart` (instant) in `tz`, within [from, to).
 * Stops after `limit` results to protect against unbounded rules.
 */
export function expandRRule(
  rrule: string | RRule,
  dtstart: number,
  tz: string,
  from: number,
  to: number,
  limit = 500,
): number[] {
  const rule = typeof rrule === 'string' ? parseRRule(rrule) : rrule;
  const local = toZoned(dtstart, tz);
  const start: DateOnly = { y: local.year, m: local.month, d: local.day };
  const out: number[] = [];
  let produced = 0;
  let guard = 0;
  for (const date of candidateDates(rule, start)) {
    if (++guard > 100_000) break;
    const lt: LocalDateTime = { year: date.y, month: date.m, day: date.d, hour: local.hour, minute: local.minute };
    const instant = fromZoned(lt, tz);
    if (rule.until !== undefined && instant > rule.until) break;
    produced++;
    if (rule.count !== undefined && produced > rule.count) break;
    if (instant >= to) break;
    if (instant >= from) {
      out.push(instant);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** First occurrence strictly after `after`, or null when the series has ended. */
export function nextOccurrence(rrule: string, dtstart: number, tz: string, after: number): number | null {
  const horizon = after + 3 * 366 * 86_400_000;
  const [next] = expandRRule(rrule, dtstart, tz, after + 1, horizon, 1);
  return next ?? null;
}
