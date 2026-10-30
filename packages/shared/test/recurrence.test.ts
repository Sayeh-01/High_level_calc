import { describe, expect, it } from 'vitest';
import { expandRRule, nextOccurrence, parseRRule } from '../src/recurrence';
import { fromZoned, toZoned } from '../src/time';

const TZ = 'Africa/Cairo';

describe('recurrence in a timezone (B9 v1.0 #5)', () => {
  it('a weekly 21:00 Cairo event stays at 21:00 local across the spring DST change', () => {
    // Egypt DST 2026 starts on the last Friday of April.
    const start = fromZoned({ year: 2026, month: 4, day: 2, hour: 21, minute: 0 }, TZ);
    const occ = expandRRule('FREQ=WEEKLY;BYDAY=TH;COUNT=10', start, TZ, start, start + 20 * 7 * 86400000);
    expect(occ.length).toBe(10);
    const utcHours = new Set<number>();
    for (const t of occ) {
      const z = toZoned(t, TZ);
      expect(z.weekday).toBe(4);
      expect([z.hour, z.minute]).toEqual([21, 0]);
      utcHours.add(new Date(t).getUTCHours());
    }
    // proves a DST change actually happened inside the range
    expect([...utcHours].sort()).toEqual([18, 19]);
  });

  it('…and across the autumn change', () => {
    const start = fromZoned({ year: 2026, month: 10, day: 1, hour: 21, minute: 0 }, TZ);
    const occ = expandRRule('FREQ=WEEKLY;BYDAY=TH', start, TZ, start, start + 8 * 7 * 86400000);
    for (const t of occ) expect(toZoned(t, TZ).hour).toBe(21);
    expect(new Set(occ.map((t) => new Date(t).getUTCHours())).size).toBe(2);
  });

  it('supports daily, interval, count, until, monthly by day and nth weekday', () => {
    const start = fromZoned({ year: 2026, month: 1, day: 31, hour: 9, minute: 30 }, TZ);
    const far = start + 400 * 86400000;
    expect(expandRRule('FREQ=DAILY;COUNT=3', start, TZ, start, far)).toHaveLength(3);
    expect(expandRRule('FREQ=DAILY;INTERVAL=2;COUNT=3', start, TZ, start, far).map((t) => toZoned(t, TZ).day)).toEqual([31, 2, 4]);
    // the 31st only exists in some months
    expect(expandRRule('FREQ=MONTHLY;COUNT=4', start, TZ, start, far).map((t) => toZoned(t, TZ).month)).toEqual([1, 3, 5, 7]);
    // last Friday of each month
    const lastFri = expandRRule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=2', start, TZ, start, far).map((t) => toZoned(t, TZ));
    expect(lastFri.map((z) => [z.month, z.day])).toEqual([[2, 27], [3, 27]]);
    const until = expandRRule('FREQ=WEEKLY;UNTIL=20260215T000000Z', start, TZ, start, far);
    expect(until).toHaveLength(3); // Jan 31, Feb 7, Feb 14
  });

  it('weekly with several days and interval', () => {
    const start = fromZoned({ year: 2026, month: 3, day: 2, hour: 8, minute: 0 }, TZ); // Monday
    const occ = expandRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', start, TZ, start, start + 30 * 86400000);
    expect(occ.map((t) => toZoned(t, TZ).day)).toEqual([2, 4, 16, 18, 30]);
  });

  it('nextOccurrence and parse errors', () => {
    const start = fromZoned({ year: 2026, month: 3, day: 2, hour: 8, minute: 0 }, TZ);
    expect(toZoned(nextOccurrence('FREQ=DAILY', start, TZ, start)!, TZ).day).toBe(3);
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', start, TZ, start)).toBeNull();
    expect(() => parseRRule('FREQ=HOURLY')).toThrow();
  });
});
