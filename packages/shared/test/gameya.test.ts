import { describe, expect, it } from 'vitest';
import { addMonths, drawOrder, gameyaSchedule, monthsBetween, swapTurns } from '../src/gameya';

describe('months', () => {
  it('adds and counts calendar months across years', () => {
    expect(addMonths('2026-11', 0)).toBe('2026-11');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-01', 23)).toBe('2027-12');
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2027-02', '2026-11')).toBe(-3);
  });
});

describe('gam’eya schedule (B9 v2.2)', () => {
  const order = ['amal', 'bassem', 'carla', 'dina', 'emad'];
  const plan = gameyaSchedule({ order, amountMinor: 200000, startMonth: '2026-11' });

  it('each member receives the pot exactly once per round', () => {
    expect(plan).toHaveLength(order.length);
    expect(plan.map((p) => p.receiverId).sort()).toEqual([...order].sort());
    expect(new Set(plan.map((p) => p.receiverId)).size).toBe(order.length);
    expect(plan.map((p) => p.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  });

  it('total paid in equals total paid out every month, and every member ends the round even', () => {
    for (const m of plan) {
      expect(m.payIn).toBe(200000 * order.length);
      expect(m.payOut).toBe(m.payIn);
    }
    for (const id of order) {
      const paid = plan.length * 200000;
      const received = plan.filter((p) => p.receiverId === id).reduce((s, p) => s + p.payOut, 0);
      expect(received - paid).toBe(0);
    }
  });

  it('refuses a member listed twice or fewer than two members', () => {
    expect(() => gameyaSchedule({ order: ['a', 'b', 'a'], amountMinor: 100, startMonth: '2026-11' })).toThrow();
    expect(() => gameyaSchedule({ order: ['a'], amountMinor: 100, startMonth: '2026-11' })).toThrow();
  });
});

describe('draw and swap', () => {
  it('a drawn order is a permutation of the members, driven by the random source', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const drawn = drawOrder(ids, rnd);
    expect([...drawn].sort()).toEqual(ids);
    expect(drawOrder(ids, () => 0.999)).not.toEqual(drawOrder(ids, () => 0));
  });

  it('a swap exchanges two turns and keeps everyone receiving exactly once', () => {
    const after = swapTurns(['a', 'b', 'c', 'd'], 'b', 'd');
    expect(after).toEqual(['a', 'd', 'c', 'b']);
    expect(() => swapTurns(['a', 'b'], 'a', 'z')).toThrow();
    expect(() => swapTurns(['a', 'b'], 'a', 'a')).toThrow();
  });
});
