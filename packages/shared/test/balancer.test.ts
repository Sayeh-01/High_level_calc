import { describe, expect, it } from 'vitest';
import { balanceTeams, type Player } from '../src/balancer';

/** Independent check: try every way to pick ⌊n/2⌋ players. */
function bruteForceDiff(players: Player[]): number {
  const n = players.length;
  const sizeA = Math.floor(n / 2);
  const s = players.map((p) => Math.round(p.skill * 10));
  const total = s.reduce((a, b) => a + b, 0);
  let best = Infinity;
  for (let mask = 0; mask < 1 << n; mask++) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < n; i++)
      if (mask & (1 << i)) {
        count++;
        sum += s[i];
      }
    if (count === sizeA) best = Math.min(best, Math.abs(total - 2 * sum));
  }
  return best / 10;
}

describe('team balancer (B9 v1.3)', () => {
  it('matches the brute-force optimum for 10–16 players', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 10; n <= 16; n++) {
      for (let trial = 0; trial < 6; trial++) {
        const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, skill: Math.round((1 + rnd() * 9) * 2) / 2 }));
        const teams = balanceTeams(players);
        expect(teams.diff).toBeCloseTo(bruteForceDiff(players), 5);
        expect(Math.abs(teams.a.length - teams.b.length)).toBeLessThanOrEqual(1);
        expect(new Set([...teams.a, ...teams.b]).size).toBe(n);
        const sum = (ids: string[]) => ids.reduce((s, id) => s + players.find((p) => p.id === id)!.skill, 0);
        expect(teams.sumA).toBeCloseTo(sum(teams.a), 5);
        expect(teams.sumB).toBeCloseTo(sum(teams.b), 5);
      }
    }
  });
  it('a perfect split exists → diff 0', () => {
    const t = balanceTeams([5, 5, 4, 4, 3, 3, 2, 2, 1, 1].map((skill, i) => ({ id: String(i), skill })));
    expect(t.diff).toBe(0);
  });
});
