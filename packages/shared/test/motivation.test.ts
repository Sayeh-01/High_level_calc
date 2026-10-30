import { describe, expect, it } from 'vitest';
import { computeStreak, localDayKey } from '../src/motivation';
import { fromZoned } from '../src/time';

const TZ = 'Africa/Cairo';
const at = (d: number, h = 12, month = 11) => fromZoned({ year: 2026, month, day: d, hour: h, minute: 0 }, TZ);

describe('streaks', () => {
  it('counts consecutive local days ending today or yesterday', () => {
    expect(computeStreak([at(1), at(2), at(3)], TZ, at(3, 20))).toBe(3);
    expect(computeStreak([at(1), at(2), at(3)], TZ, at(4, 9))).toBe(3); // today not done yet
    expect(computeStreak([at(1), at(2), at(3)], TZ, at(5, 9))).toBe(0); // missed a day
    expect(computeStreak([at(1), at(3)], TZ, at(3, 20))).toBe(1);
    expect(computeStreak([], TZ, at(3))).toBe(0);
  });
  it('uses the group timezone: 23:30 Cairo is still the same day', () => {
    const lateNight = fromZoned({ year: 2026, month: 11, day: 2, hour: 23, minute: 30 }, TZ);
    expect(localDayKey(lateNight, TZ)).toBe('2026-11-02');
    expect(localDayKey(lateNight, 'UTC')).toBe('2026-11-02');
    expect(localDayKey(lateNight, 'Asia/Dubai')).toBe('2026-11-03');
    expect(computeStreak([at(1), lateNight], TZ, at(3, 8))).toBe(2);
  });
  it('crosses month ends', () => {
    expect(computeStreak([at(30, 12, 10), at(31, 12, 10), at(1)], TZ, at(1, 20))).toBe(3);
  });
});
