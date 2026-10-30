import { describe, expect, it } from 'vitest';
import { minutesBetween, overlaps } from '../src/shifts';

describe('shift overlap (B9 v3.x)', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h, m));
  it('two shifts overlap when one starts before the other ends; touching ends do not', () => {
    expect(overlaps({ startsAt: at(9), endsAt: at(17) }, { startsAt: at(16), endsAt: at(20) })).toBe(true);
    expect(overlaps({ startsAt: at(9), endsAt: at(17) }, { startsAt: at(10), endsAt: at(11) })).toBe(true);
    expect(overlaps({ startsAt: at(9), endsAt: at(17) }, { startsAt: at(17), endsAt: at(22) })).toBe(false);
    expect(overlaps({ startsAt: at(9), endsAt: at(17) }, { startsAt: at(6), endsAt: at(9) })).toBe(false);
  });
  it('counts minutes', () => {
    expect(minutesBetween(at(9), at(17, 30))).toBe(510);
  });
});
