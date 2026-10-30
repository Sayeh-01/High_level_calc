import { describe, expect, it } from 'vitest';
import { computeBalances, computeShares, feeMinor, parseMajorToMinor, simplifyDebts, splitEqual, splitByWeights } from '../src/money';

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('splits (B9 v1.0 #1)', () => {
  it('100.00 split three ways = 33.34 / 33.33 / 33.33', () => {
    expect(splitEqual(10000, ['a', 'b', 'c'])).toEqual({ a: 3334, b: 3333, c: 3333 });
  });

  it('equal, exact and shares splits always sum exactly to the total', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let i = 0; i < 500; i++) {
      const total = rnd(10_000_000) + 1;
      const members = Array.from({ length: rnd(12) + 1 }, (_, k) => `m${k}`);
      expect(sum(computeShares(total, { kind: 'equal', members }))).toBe(total);
      const shares = Object.fromEntries(members.map((m) => [m, rnd(5) + 1]));
      expect(sum(computeShares(total, { kind: 'shares', shares }))).toBe(total);
      const amounts = splitEqual(total, members);
      expect(sum(computeShares(total, { kind: 'exact', amounts }))).toBe(total);
    }
  });

  it('exact amounts that do not add up are rejected', () => {
    expect(() => computeShares(1000, { kind: 'exact', amounts: { a: 500, b: 499 } })).toThrow();
  });

  it('shares split by weight (room sizes 2:1:1)', () => {
    expect(splitByWeights(1000, { a: 2, b: 1, c: 1 })).toEqual({ a: 500, b: 250, c: 250 });
    expect(sum(splitByWeights(1001, { a: 2, b: 1, c: 1 }))).toBe(1001);
  });

  it('percent split must total 100', () => {
    expect(computeShares(999, { kind: 'percent', percents: { a: 50, b: 50 } })).toEqual({ a: 500, b: 499 });
    expect(() => computeShares(999, { kind: 'percent', percents: { a: 50, b: 40 } })).toThrow();
  });
});

describe('balances (B9 v1.0 #2)', () => {
  const expense = { payerId: 'A', amount: 30000, shares: computeShares(30000, { kind: 'equal', members: ['A', 'B', 'C'] }) };

  it('A pays 300 split equally → B owes A 100, C owes A 100', () => {
    const bal = computeBalances([expense], []);
    expect(bal).toEqual({ A: 20000, B: -10000, C: -10000 });
    expect(simplifyDebts(bal)).toEqual([
      { from: 'B', to: 'A', amount: 10000 },
      { from: 'C', to: 'A', amount: 10000 },
    ]);
  });

  it('an unconfirmed settlement changes nothing; a confirmed one clears B', () => {
    const pending = { fromId: 'B', toId: 'A', amount: 10000, confirmed: false };
    expect(computeBalances([expense], [pending])).toEqual({ A: 20000, B: -10000, C: -10000 });
    const confirmed = { ...pending, confirmed: true };
    const bal = computeBalances([expense], [confirmed]);
    expect(bal.B).toBe(0);
    expect(bal.A).toBe(10000);
  });
});

describe('simplify debts (B9 v1.0 #3)', () => {
  it('produces at most n−1 transfers and keeps every net balance, random cases', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let i = 0; i < 300; i++) {
      const n = rnd(10) + 2;
      const ids = Array.from({ length: n }, (_, k) => `u${k}`);
      const expenses = Array.from({ length: rnd(8) + 1 }, () => {
        const amount = rnd(100000) + 1;
        const members = ids.filter(() => rnd(2) === 0);
        if (members.length === 0) members.push(ids[0]);
        return { payerId: ids[rnd(n)], amount, shares: splitEqual(amount, members) };
      });
      const bal = computeBalances(expenses, []);
      const transfers = simplifyDebts(bal);
      const nonZero = Object.values(bal).filter((v) => v !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      const after: Record<string, number> = { ...bal };
      for (const t of transfers) {
        expect(t.amount).toBeGreaterThan(0);
        after[t.from] += t.amount;
        after[t.to] -= t.amount;
      }
      for (const v of Object.values(after)) expect(v).toBe(0);
    }
  });
});

describe('helpers', () => {
  it('parses Arabic and Western digits into minor units', () => {
    expect(parseMajorToMinor('50')).toBe(5000);
    expect(parseMajorToMinor('٥٠٫٢٥')).toBe(5025);
    expect(parseMajorToMinor('12.345')).toBeNull();
    expect(parseMajorToMinor('abc')).toBeNull();
  });
  it('fees round half-up in minor units', () => {
    expect(feeMinor(10000, 250)).toBe(250);
    expect(feeMinor(333, 150)).toBe(5); // 4.995 → 5
    expect(feeMinor(330, 150)).toBe(5); // 4.95 → 5
    expect(feeMinor(329, 150)).toBe(5); // 4.935 → 5
    expect(feeMinor(300, 150)).toBe(5); // 4.5 → 5
    expect(feeMinor(299, 150)).toBe(4); // 4.485 → 4
  });
});
