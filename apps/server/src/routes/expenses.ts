import { computeBalances, computeShares, convertMinor, MoneyError, schemas, simplifyDebts, splitEqual, type Split } from '@circle/shared';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { eventRsvps, events, expenseShares, expenses, settlements } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';
import { assertMembers } from './groups';

export async function groupLedger(db: DbOrTx, groupId: string) {
  const exps = await db.select().from(expenses).where(and(eq(expenses.groupId, groupId), isNull(expenses.reversedAt)));
  const shares = exps.length ? await db.select().from(expenseShares).where(inArray(expenseShares.expenseId, exps.map((e) => e.id))) : [];
  const setts = await db.select().from(settlements).where(and(eq(settlements.groupId, groupId), isNull(settlements.rejectedAt)));
  const ledger = exps.map((e) => ({
    payerId: e.payerId,
    amount: e.amountMinor,
    shares: Object.fromEntries(shares.filter((s) => s.expenseId === e.id).map((s) => [s.userId, s.amountMinor])),
  }));
  const balances = computeBalances(
    ledger,
    setts.map((s) => ({ fromId: s.fromId, toId: s.toId, amount: s.amountMinor, confirmed: !!s.confirmedAt })),
  );
  return { balances, settlements: setts };
}

export interface CreateExpenseInput {
  groupId: string;
  actorId: string;
  title: string;
  amount: number;
  payerId: string;
  split: Split;
  currency: string;
  groupCurrency: string;
  rate?: number;
  eventId?: string | null;
  taskId?: string | null;
  category?: string | null;
  spentAt?: Date;
}

/** One transaction per money write (B6). Shares always add up exactly to the converted amount. */
export async function createExpense(tx: DbOrTx, deps: Deps, a: CreateExpenseInput) {
  const foreign = a.currency !== a.groupCurrency;
  if (foreign && !a.rate) throw badRequest('rate_required', 'A foreign-currency expense needs an exchange rate');
  const rate = foreign ? a.rate! : 1;
  const amount = foreign ? convertMinor(a.amount, rate) : a.amount;
  let split = a.split;
  // exact amounts are entered in the original currency: convert each and keep the total exact
  if (foreign && split.kind === 'exact') {
    split = { kind: 'shares', shares: split.amounts };
  }
  let shares: Record<string, number>;
  try {
    shares = computeShares(amount, split);
  } catch (e) {
    if (e instanceof MoneyError) throw badRequest('bad_split', e.message);
    throw e;
  }
  await assertMembers(tx, a.groupId, [a.payerId, ...Object.keys(shares)]);
  const id = newId();
  const [row] = await tx
    .insert(expenses)
    .values({
      id,
      groupId: a.groupId,
      title: a.title,
      amountMinor: amount,
      currency: a.currency,
      originalMinor: a.amount,
      rate,
      payerId: a.payerId,
      splitKind: a.split.kind,
      category: a.category ?? null,
      eventId: a.eventId ?? null,
      taskId: a.taskId ?? null,
      spentAt: a.spentAt ?? deps.clock(),
      createdBy: a.actorId,
    })
    .returning();
  const shareRows = Object.entries(shares)
    .filter(([, v]) => v !== 0)
    .map(([userId, amountMinor]) => ({ expenseId: id, groupId: a.groupId, userId, amountMinor }));
  if (shareRows.length) await tx.insert(expenseShares).values(shareRows);
  await logActivity(tx, { groupId: a.groupId, actorId: a.actorId, verb: 'created', entity: 'expense', entityId: id, summary: `${a.title} · ${amount}` });
  await notify(tx, {
    userIds: [a.payerId, ...shareRows.map((s) => s.userId)],
    exclude: a.actorId,
    groupId: a.groupId,
    kind: 'expense',
    title: a.title,
    body: `New expense: ${(amount / 100).toFixed(2)} ${a.groupCurrency}`,
    data: { expenseId: id },
    now: deps.clock(),
  });
  return { ...row, shares: shareRows };
}

export const expenseHooks: ((tx: DbOrTx, deps: Deps, expense: typeof expenses.$inferSelect) => Promise<void>)[] = [];

export function registerExpenseRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';
  const mod = { module: 'expenses', tags: ['expenses'] };

  r.get(`${base}/expenses`, { ...mod, perm: 'money.read', summary: 'Expenses with shares' }, async (c) => {
    const groupId = c.get('group').id;
    const rows = await db.select().from(expenses).where(eq(expenses.groupId, groupId)).orderBy(desc(expenses.spentAt)).limit(300);
    const shares = rows.length ? await db.select().from(expenseShares).where(inArray(expenseShares.expenseId, rows.map((e) => e.id))) : [];
    return rows.map((e) => ({ ...e, shares: shares.filter((s) => s.expenseId === e.id) }));
  });

  r.post(`${base}/expenses`, { ...mod, perm: 'money.write', summary: 'Add an expense', body: schemas.expenseCreate }, async (c, { body }) => {
    const group = c.get('group');
    if (body.eventId) {
      const [ev] = await db.select().from(events).where(and(eq(events.id, body.eventId), eq(events.groupId, group.id)));
      if (!ev) throw badRequest('bad_event');
    }
    const row = await db.transaction(async (tx) => {
      const e = await createExpense(tx, deps, {
        groupId: group.id,
        actorId: c.get('user').id,
        title: body.title,
        amount: body.amount,
        payerId: body.payerId,
        split: body.split,
        currency: body.currency ?? group.currency,
        groupCurrency: group.currency,
        rate: body.rate,
        eventId: body.eventId,
        category: body.category,
        spentAt: body.spentAt ? new Date(body.spentAt) : undefined,
      });
      for (const hook of expenseHooks) await hook(tx, deps, e);
      return e;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'expenses' });
    return row;
  });

  r.post(`${base}/expenses/:expenseId/reverse`, { ...mod, perm: 'money.write', summary: 'Reverse an expense (money entries are never edited)' }, async (c) => {
    const group = c.get('group');
    const user = c.get('user');
    const [e] = await db.select().from(expenses).where(and(eq(expenses.id, c.req.param('expenseId')!), eq(expenses.groupId, group.id)));
    if (!e) throw notFound();
    if (e.createdBy !== user.id && e.payerId !== user.id && !actorCan(c, 'items.manage')) throw forbidden();
    if (e.reversedAt) return { ok: true };
    await db.transaction(async (tx) => {
      await tx.update(expenses).set({ reversedAt: deps.clock(), reversedBy: user.id }).where(and(eq(expenses.id, e.id), eq(expenses.groupId, group.id)));
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'reversed', entity: 'expense', entityId: e.id, summary: e.title });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'expenses' });
    return { ok: true };
  });

  r.get(`${base}/balances`, { ...mod, perm: 'money.read', summary: 'Net balances, simplified debts, pending settlements' }, async (c) => {
    const group = c.get('group');
    const { balances, settlements: setts } = await groupLedger(db, group.id);
    return {
      currency: group.currency,
      balances,
      transfers: simplifyDebts(balances),
      pending: setts.filter((s) => !s.confirmedAt),
      settled: setts.filter((s) => s.confirmedAt).slice(-50),
    };
  });

  r.post(`${base}/settlements`, { ...mod, perm: 'money.write', summary: 'Record a payment; it counts after the receiver confirms', body: schemas.settlementCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    if (body.toId === user.id) throw badRequest('cannot_pay_yourself');
    await assertMembers(db, group.id, [body.toId]);
    const row = await db.transaction(async (tx) => {
      const [s] = await tx.insert(settlements).values({ id: newId(), groupId: group.id, fromId: user.id, toId: body.toId, amountMinor: body.amount, method: body.method, note: body.note ?? null }).returning();
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'paid', entity: 'settlement', entityId: s.id, summary: String(body.amount) });
      await notify(tx, { userIds: [body.toId], groupId: group.id, kind: 'settlement_pending', title: 'Confirm a payment', body: `${c.get('member').displayName} says they paid you ${(body.amount / 100).toFixed(2)} ${group.currency}`, data: { settlementId: s.id, category: 'settle' }, now: deps.clock() });
      return s;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'expenses' });
    return row;
  });

  for (const action of ['confirm', 'reject'] as const) {
    r.post(`${base}/settlements/:settlementId/${action}`, { ...mod, perm: 'money.read', summary: `Receiver ${action}s a payment` }, async (c) => {
      const group = c.get('group');
      const user = c.get('user');
      const row = await db.transaction(async (tx) => {
        const [s] = await tx.select().from(settlements).where(and(eq(settlements.id, c.req.param('settlementId')!), eq(settlements.groupId, group.id))).for('update');
        if (!s) throw notFound();
        if (s.toId !== user.id) throw forbidden('only_receiver');
        if (s.confirmedAt || s.rejectedAt) return s;
        const [u] = await tx
          .update(settlements)
          .set(action === 'confirm' ? { confirmedAt: deps.clock() } : { rejectedAt: deps.clock() })
          .where(eq(settlements.id, s.id))
          .returning();
        await logActivity(tx, { groupId: group.id, actorId: user.id, verb: action === 'confirm' ? 'confirmed' : 'rejected', entity: 'settlement', entityId: s.id, summary: String(s.amountMinor) });
        await notify(tx, { userIds: [s.fromId], groupId: group.id, kind: `settlement_${action}ed`, title: action === 'confirm' ? 'Payment confirmed' : 'Payment not confirmed', body: `${(s.amountMinor / 100).toFixed(2)} ${group.currency}`, data: { settlementId: s.id }, now: deps.clock() });
        return u;
      });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'expenses' });
      return row;
    });
  }

  r.post(`${base}/events/:eventId/split`, { module: 'expenses', tags: ['expenses'], perm: 'money.write', summary: "Split this event's cost among Going", body: schemas.splitEvent }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const [ev] = await db.select().from(events).where(and(eq(events.id, c.req.param('eventId')!), eq(events.groupId, group.id)));
    if (!ev) throw notFound();
    const going = (await db.select({ u: eventRsvps.userId }).from(eventRsvps).where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.status, 'going')))).map((g) => g.u).sort();
    if (going.length === 0) throw badRequest('nobody_going');
    const row = await db.transaction((tx) =>
      createExpense(tx, deps, {
        groupId: group.id,
        actorId: user.id,
        title: body.title ?? ev.title,
        amount: body.amount,
        payerId: body.payerId ?? user.id,
        split: { kind: 'equal', members: going },
        currency: group.currency,
        groupCurrency: group.currency,
        eventId: ev.id,
      }),
    );
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'expenses' });
    return { ...row, perPerson: splitEqual(body.amount, going) };
  });
}

export const settlementFilter = (userId: string) => or(eq(settlements.fromId, userId), eq(settlements.toId, userId));
