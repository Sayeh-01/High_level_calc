/**
 * Round-robin rotation. Given the rotation order and the member who had the last turn,
 * returns the next member, skipping anyone marked away. Returns null if everyone is away.
 */
export function nextInRotation(order: string[], lastId: string | null, away: Iterable<string> = []): string | null {
  if (order.length === 0) return null;
  const skip = new Set(away);
  const start = lastId === null ? -1 : order.indexOf(lastId);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step + order.length) % order.length];
    if (!skip.has(candidate)) return candidate;
  }
  return null;
}

/** Points share per member as integer percentages that add up to exactly 100 (largest remainder). */
export function fairnessShares(points: Record<string, number>): Record<string, number> {
  const ids = Object.keys(points);
  const total = ids.reduce((s, id) => s + Math.max(0, points[id]), 0);
  if (ids.length === 0) return {};
  if (total === 0) {
    const out: Record<string, number> = {};
    const base = Math.floor(100 / ids.length);
    let rest = 100 - base * ids.length;
    for (const id of ids) {
      out[id] = base + (rest > 0 ? 1 : 0);
      rest--;
    }
    return out;
  }
  const raw = ids.map((id, i) => {
    const exact = (Math.max(0, points[id]) * 100) / total;
    return { id, floor: Math.floor(exact), frac: exact - Math.floor(exact), i };
  });
  let rest = 100 - raw.reduce((s, r) => s + r.floor, 0);
  for (const r of [...raw].sort((a, b) => b.frac - a.frac || a.i - b.i)) {
    if (rest <= 0) break;
    r.floor++;
    rest--;
  }
  return Object.fromEntries(raw.map((r) => [r.id, r.floor]));
}
