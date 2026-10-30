import { describe, expect, it } from 'vitest';
import { NEW_CARD, review } from '../src/srs';

describe('spaced repetition (SM-2, B9 v1.3)', () => {
  it('intervals grow 1 → 6 → interval × ease on good answers', () => {
    const r1 = review(NEW_CARD, 4);
    expect(r1).toEqual({ ease: 2.5, interval: 1, reps: 1 });
    const r2 = review(r1, 4);
    expect(r2).toEqual({ ease: 2.5, interval: 6, reps: 2 });
    const r3 = review(r2, 4);
    expect(r3).toEqual({ ease: 2.5, interval: 15, reps: 3 });
    const r4 = review(r3, 5);
    expect(r4.ease).toBe(2.6);
    expect(r4.interval).toBe(39);
  });
  it('a hard answer lowers ease; forgetting resets the interval', () => {
    const hard = review({ ease: 2.5, interval: 6, reps: 2 }, 3);
    expect(hard.ease).toBe(2.36);
    expect(hard.interval).toBe(14);
    const forgot = review({ ease: 2.5, interval: 40, reps: 5 }, 1);
    expect(forgot).toEqual({ ease: 2.3, interval: 1, reps: 0 });
  });
  it('ease never drops below 1.3', () => {
    let s = NEW_CARD;
    for (let i = 0; i < 20; i++) s = review(s, 0);
    expect(s.ease).toBe(1.3);
    expect(() => review(NEW_CARD, 6)).toThrow();
  });
});
