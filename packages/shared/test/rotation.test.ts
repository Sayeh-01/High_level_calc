import { describe, expect, it } from 'vitest';
import { fairnessShares, nextInRotation } from '../src/rotation';

describe('rotation (B9 v1.0 #4)', () => {
  it('goes A → B → C → A', () => {
    const order = ['A', 'B', 'C'];
    expect(nextInRotation(order, null)).toBe('A');
    expect(nextInRotation(order, 'A')).toBe('B');
    expect(nextInRotation(order, 'B')).toBe('C');
    expect(nextInRotation(order, 'C')).toBe('A');
  });
  it('skips members marked away', () => {
    expect(nextInRotation(['A', 'B', 'C'], 'A', ['B'])).toBe('C');
    expect(nextInRotation(['A', 'B', 'C'], 'C', ['A'])).toBe('B');
    expect(nextInRotation(['A', 'B', 'C'], 'A', ['B', 'C'])).toBe('A');
  });
  it('returns null when everyone is away', () => {
    expect(nextInRotation(['A', 'B'], 'A', ['A', 'B'])).toBeNull();
  });
  it('a member who left the rotation restarts from the top', () => {
    expect(nextInRotation(['A', 'B'], 'Z')).toBe('A');
  });
});

describe('fairness meter', () => {
  it('shares add up to 100%', () => {
    for (const pts of <Record<string, number>[]>[{ a: 1, b: 1, c: 1 }, { a: 7, b: 0, c: 3 }, { a: 0, b: 0 }, { a: 5 }, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }]) {
      const shares = fairnessShares(pts);
      expect(Object.values(shares).reduce((s, v) => s + v, 0)).toBe(100);
    }
    expect(fairnessShares({ a: 3, b: 1 })).toEqual({ a: 75, b: 25 });
  });
});
