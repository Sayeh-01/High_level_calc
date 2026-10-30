// Gam'eya (rotating savings circle): every member pays the same amount each month and one member takes the whole pot.
// Pure planning helpers; the server records payments against this plan. The app never holds the money (A12).

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** b − a in calendar months ('YYYY-MM'). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
}

export interface GameyaMonth {
  position: number;
  month: string;
  receiverId: string;
  /** what all members pay in that month */
  payIn: number;
  /** what the receiver takes */
  payOut: number;
}

/** One month per member, in payout order. Everyone (the receiver too) pays each month, so in = out every month. */
export function gameyaSchedule(a: { order: string[]; amountMinor: number; startMonth: string }): GameyaMonth[] {
  if (a.order.length < 2) throw new Error('a gam’eya needs at least two members');
  if (new Set(a.order).size !== a.order.length) throw new Error('each member holds exactly one turn');
  const pot = a.amountMinor * a.order.length;
  return a.order.map((receiverId, i) => ({ position: i + 1, month: addMonths(a.startMonth, i), receiverId, payIn: pot, payOut: pot }));
}

/** Fisher–Yates with an injected random source (crypto on the server, seeded in tests). */
export function drawOrder(ids: string[], random: () => number): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function swapTurns(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0 || i === j) throw new Error('both members must hold different turns');
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
