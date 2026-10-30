// Money is always integer minor units (piasters / cents). Never floats.

export type Split =
  | { kind: 'equal'; members: string[] }
  | { kind: 'exact'; amounts: Record<string, number> }
  | { kind: 'shares'; shares: Record<string, number> }
  | { kind: 'percent'; percents: Record<string, number> };

export class MoneyError extends Error {}

function assertMinor(n: number, what: string) {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${what} must be an integer number of minor units`);
}

/** Leftover units go to members in the order given (callers pass a stable order). */
export function splitEqual(total: number, members: string[]): Record<string, number> {
  assertMinor(total, 'total');
  if (members.length === 0) throw new MoneyError('split needs at least one member');
  const base = Math.trunc(total / members.length);
  let rest = total - base * members.length;
  const out: Record<string, number> = {};
  for (const m of members) {
    const extra = rest > 0 ? 1 : rest < 0 ? -1 : 0;
    out[m] = base + extra;
    rest -= extra;
  }
  return out;
}

/** Largest-remainder apportionment by weight, ties broken by input order. */
export function splitByWeights(total: number, weights: Record<string, number>): Record<string, number> {
  assertMinor(total, 'total');
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) throw new MoneyError('split needs at least one positive share');
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = entries.map(([id, w], i) => {
    const exact = (abs * w) / sum;
    const floor = Math.floor(exact);
    return { id, floor, frac: exact - floor, i };
  });
  let rest = abs - raw.reduce((s, r) => s + r.floor, 0);
  const order = [...raw].sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const r of order) {
    if (rest <= 0) break;
    r.floor += 1;
    rest -= 1;
  }
  const out: Record<string, number> = {};
  for (const r of raw) out[r.id] = sign * r.floor;
  return out;
}

export function computeShares(total: number, split: Split): Record<string, number> {
  assertMinor(total, 'total');
  switch (split.kind) {
    case 'equal':
      return splitEqual(total, split.members);
    case 'exact': {
      const vals = Object.values(split.amounts);
      vals.forEach((v) => assertMinor(v, 'share'));
      const sum = vals.reduce((s, v) => s + v, 0);
      if (sum !== total) throw new MoneyError(`exact amounts add up to ${sum}, expected ${total}`);
      return { ...split.amounts };
    }
    case 'shares':
      return splitByWeights(total, split.shares);
    case 'percent': {
      const sum = Object.values(split.percents).reduce((s, v) => s + v, 0);
      if (Math.abs(sum - 100) > 1e-9) throw new MoneyError(`percentages add up to ${sum}, expected 100`);
      return splitByWeights(total, split.percents);
    }
  }
}

export interface LedgerExpense {
  payerId: string;
  amount: number;
  shares: Record<string, number>;
}
export interface LedgerSettlement {
  fromId: string;
  toId: string;
  amount: number;
  confirmed: boolean;
}

/** Net balance per member: positive = is owed money, negative = owes. Unconfirmed settlements are ignored. */
export function computeBalances(expenses: LedgerExpense[], settlements: LedgerSettlement[]): Record<string, number> {
  const net: Record<string, number> = {};
  const add = (id: string, v: number) => (net[id] = (net[id] ?? 0) + v);
  for (const e of expenses) {
    add(e.payerId, e.amount);
    for (const [id, share] of Object.entries(e.shares)) add(id, -share);
  }
  for (const s of settlements) {
    if (!s.confirmed) continue;
    add(s.fromId, s.amount);
    add(s.toId, -s.amount);
  }
  return net;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** Greedy largest-debtor → largest-creditor matching: at most n−1 transfers, preserves every net balance. */
export function simplifyDebts(balances: Record<string, number>): Transfer[] {
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amt: -v }));
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, amt: v }));
  const byAmt = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || (a.id < b.id ? -1 : 1);
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmt);
    creditors.sort(byAmt);
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.amt, c.amt);
    out.push({ from: d.id, to: c.id, amount: amt });
    d.amt -= amt;
    c.amt -= amt;
    if (d.amt === 0) debtors.shift();
    if (c.amt === 0) creditors.shift();
  }
  return out;
}

/** Convert a foreign amount to the settle currency with a stored manual rate (rate = settle units per 1 foreign unit). */
export function convertMinor(amount: number, rate: number): number {
  assertMinor(amount, 'amount');
  return Math.round(amount * rate);
}

/** Fee in minor units from basis points, rounded half-up. */
export function feeMinor(amount: number, basisPoints: number, fixedMinor = 0): number {
  assertMinor(amount, 'amount');
  return Math.floor((amount * basisPoints + 5000) / 10000) + fixedMinor;
}

export function parseMajorToMinor(input: string, decimals = 2): number | null {
  const normalized = toWesternDigits(input.trim()).replace(/[,٬\s]/g, '').replace('٫', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.replace('-', '').split('.');
  if (frac.length > decimals) return null;
  const minor = Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  return normalized.startsWith('-') ? -minor : minor;
}

export function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
