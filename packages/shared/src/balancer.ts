export interface Player {
  id: string;
  /** Skill rating; any non-negative number (stored with one decimal → scaled to integers internally). */
  skill: number;
}

export interface Teams {
  a: string[];
  b: string[];
  sumA: number;
  sumB: number;
  diff: number;
}

/**
 * Two teams whose sizes differ by at most one, with the smallest possible skill difference.
 * Exact: dynamic programming over (team size, skill sum) — O(n² · Σskill), fine for squads up to ~40.
 */
export function balanceTeams(players: Player[]): Teams {
  const n = players.length;
  const scaled = players.map((p) => Math.round(p.skill * 10));
  const total = scaled.reduce((s, v) => s + v, 0);
  const sizeA = Math.floor(n / 2);
  // reach[k] = Set of sums reachable with k players; parent pointers for reconstruction
  const reach: Map<number, { prev: number; item: number }>[] = Array.from({ length: sizeA + 1 }, () => new Map());
  reach[0].set(0, { prev: -1, item: -1 });
  for (let i = 0; i < n; i++) {
    const snapshot = reach.map((m) => new Map(m));
    for (let k = Math.min(i + 1, sizeA); k >= 1; k--) {
      for (const [sum] of snapshot[k - 1]) {
        const next = sum + scaled[i];
        if (!reach[k].has(next)) reach[k].set(next, { prev: sum, item: i });
      }
    }
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const sum of reach[sizeA].keys()) {
    const d = Math.abs(total - 2 * sum);
    if (d < bestDiff || (d === bestDiff && sum > best)) {
      bestDiff = d;
      best = sum;
    }
  }
  // Reconstruct by walking parent pointers. (k, sum) was first reached with item i from (k-1, prev), which was already
  // reachable before item i — so every step uses a different, earlier player.
  const inA = new Set<number>();
  let k = sizeA;
  let sum = best;
  while (k > 0) {
    const entry = reach[k].get(sum)!;
    inA.add(entry.item);
    sum = entry.prev;
    k--;
  }
  const a = players.filter((_, i) => inA.has(i));
  const b = players.filter((_, i) => !inA.has(i));
  const sA = a.reduce((s, p) => s + Math.round(p.skill * 10), 0) / 10;
  const sB = b.reduce((s, p) => s + Math.round(p.skill * 10), 0) / 10;
  return { a: a.map((p) => p.id), b: b.map((p) => p.id), sumA: sA, sumB: sB, diff: Math.round(Math.abs(sA - sB) * 10) / 10 };
}
