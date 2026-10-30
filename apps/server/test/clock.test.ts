import { describe, expect, it } from 'vitest';
import { CLOCK_WINDOW_MS, clockCode, clockCodeValid } from '../src/clock';

describe('clock-in code (B9 v3.x): expires within 60 s', () => {
  const key = 'group-secret';
  it('is 6 digits, the same inside a window, valid for the current and previous window only', () => {
    const t0 = Date.UTC(2026, 10, 9, 8, 0, 0); // a window boundary
    const code = clockCode(key, t0);
    expect(code).toMatch(/^\d{6}$/);
    expect(clockCode(key, t0 + CLOCK_WINDOW_MS - 1)).toBe(code);
    expect(clockCodeValid(key, code, t0 + 59_999)).toBe(true);
    expect(clockCodeValid(key, code, t0 + 60_000)).toBe(false);
    // shown at the end of a window it lives even shorter
    const late = clockCode(key, t0 + 29_000);
    expect(clockCodeValid(key, late, t0 + 29_000 + 30_999)).toBe(true); // ~31 s old
    expect(clockCodeValid(key, late, t0 + 29_000 + 31_000)).toBe(false);
  });
  it('another group’s key or a wrong code never works', () => {
    const t0 = Date.UTC(2026, 10, 9, 8, 0, 0);
    expect(clockCodeValid('other-secret', clockCode(key, t0), t0)).toBe(false);
    expect(clockCodeValid(key, '000000', t0) && clockCode(key, t0) !== '000000').toBe(false);
  });
});
