import { addMonths, drawOrder, fromZoned, gameyaSchedule, localDayKey, monthsBetween, schemas, swapTurns } from '@circle/shared';
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { gameyaPayments, gameyas, gameyaSlots, gameyaSwaps, groupMembers, groups } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { registerJob } from '../jobs';
import { todaySections } from './me';

// Gam'eya (A6 Savings Circle, A12): rounds, payout order, payment board, swaps, reminders, trust record. Tracking only.

const ADULT = ['owner', 'admin', 'manager', 'member'];
const fmt = (minor: number) => (minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

type Gameya = typeof gameyas.$inferSelect;

/** The month number (1-based) the round is in at `now`; 0 before it starts, > N after it ends. */
export function currentPosition(g: Gameya, now: Date, tz: string) {
  return monthsBetween(g.startMonth, localDayKey(now.getTime(), tz).slice(0, 7)) + 1;
}

function dueAt(g: { startMonth: string; dueDay: number }, position: number, tz: string) {
  const [y, m] = addMonths(g.startMonth, position - 1).split('-').map(Number);
  return new Date(fromZoned({ year: y, month: m, day: g.dueDay, hour: 23, minute: 59 }, tz));
}

async function orderOf(db: DbOrTx, gameyaId: string) {
  return (await db.select().from(gameyaSlots).where(eq(gameyaSlots.gameyaId, gameyaId)).orderBy(asc(gameyaSlots.position))).map((s) => s.userId);
}

/** Creates the round: slots, every payment row, the receiver's own share confirmed, one reminder per month. */
async function startRound(tx: DbOrTx, deps: Deps, a: { groupId: string; tz: string; title: string; amountMinor: number; startMonth: string; dueDay: number; orderMode: string; order: string[]; userId: string; round?: number; previousId?: string }) {
  const plan = gameyaSchedule({ order: a.order, amountMinor: a.amountMinor, startMonth: a.startMonth });
  const now = deps.clock();
  const [g] = await tx
    .insert(gameyas)
    .values({ id: newId(), groupId: a.groupId, title: a.title, amountMinor: a.amountMinor, startMonth: a.startMonth, dueDay: a.dueDay, orderMode: a.orderMode, round: a.round ?? 1, previousId: a.previousId ?? null, createdBy: a.userId, createdAt: now })
    .returning();
  await tx.insert(gameyaSlots).values(plan.map((p) => ({ gameyaId: g.id, groupId: a.groupId, position: p.position, userId: p.receiverId })));
  await tx.insert(gameyaPayments).values(
    plan.flatMap((p) =>
      a.order.map((payerId) => ({
        id: newId(),
        gameyaId: g.id,
        groupId: a.groupId,
        position: p.position,
        payerId,
        amountMinor: a.amountMinor,
        dueAt: dueAt(g, p.position, a.tz),
        confirmedAt: payerId === p.receiverId ? now : null,
        confirmedBy: payerId === p.receiverId ? payerId : null,
      })),
    ),
  );
  for (const p of plan) {
    const [y, m] = p.month.split('-').map(Number);
    const at = fromZoned({ year: y, month: m, day: Math.max(1, a.dueDay - 1), hour: 9, minute: 0 }, a.tz);
    if (at > now.getTime()) await enqueueJob(tx, { kind: 'gameya_reminder', payload: { gameyaId: g.id, position: p.position }, runAt: new Date(at), dedupeKey: `gameya_reminder:${g.id}:${p.position}` });
  }
  for (const p of plan)
    await notify(tx, { userIds: [p.receiverId], groupId: a.groupId, kind: 'gameya_turn', title: `💰 ${a.title}`, body: `Your turn to receive ${fmt(p.payOut)} is month ${p.position} (${p.month})`, data: { gameyaId: g.id, position: p.position }, now });
  return g;
}

registerJob('gameya_reminder', async (deps, p) => {
  const [g] = await deps.db.select().from(gameyas).where(eq(gameyas.id, p.gameyaId));
  if (!g || g.status !== 'active') return;
  const [slot] = await deps.db.select().from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, g.id), eq(gameyaSlots.position, p.position)));
  const open = await deps.db
    .select()
    .from(gameyaPayments)
    .where(and(eq(gameyaPayments.gameyaId, g.id), eq(gameyaPayments.position, p.position), isNull(gameyaPayments.confirmedAt), isNull(gameyaPayments.reportedAt)));
  await notify(deps.db, { userIds: open.map((x) => x.payerId), groupId: g.groupId, kind: 'gameya_due', title: `💰 ${g.title}`, body: `${fmt(g.amountMinor)} due tomorrow`, data: { gameyaId: g.id, position: p.position, href: `/g/${g.groupId}/gameya/${g.id}` }, now: deps.clock() });
  if (slot) await notify(deps.db, { userIds: [slot.userId], groupId: g.groupId, kind: 'gameya_turn', title: `💰 ${g.title}`, body: `You receive the pot this month`, data: { gameyaId: g.id, position: p.position }, now: deps.clock() });
});

/** Today: "month 4 of 10 · 2,000 due Sunday · your turn is month 7" (A2). */
todaySections.push(async (db, deps, { userId, groups: gs, now }) => {
  const ids = gs.filter((g) => g.modules.includes('gameya') && ADULT.includes(g.role)).map((g) => g.id);
  if (!ids.length) return { gameya: [] };
  const mine = await db
    .select({ g: gameyas, position: gameyaSlots.position, tz: groups.timezone })
    .from(gameyaSlots)
    .innerJoin(gameyas, eq(gameyas.id, gameyaSlots.gameyaId))
    .innerJoin(groups, eq(groups.id, gameyas.groupId))
    .where(and(eq(gameyaSlots.userId, userId), inArray(gameyas.groupId, ids), eq(gameyas.status, 'active')));
  const out = [];
  for (const { g, position, tz } of mine) {
    const months = (await db.select({ p: gameyaSlots.position }).from(gameyaSlots).where(eq(gameyaSlots.gameyaId, g.id))).length;
    const cur = currentPosition(g, now, tz);
    const [due] = await db
      .select()
      .from(gameyaPayments)
      .where(and(eq(gameyaPayments.gameyaId, g.id), eq(gameyaPayments.payerId, userId), isNull(gameyaPayments.confirmedAt), isNull(gameyaPayments.reportedAt)))
      .orderBy(asc(gameyaPayments.position))
      .limit(1);
    const tag = gs.find((x) => x.id === g.groupId)!;
    out.push({
      gameyaId: g.id,
      groupId: g.groupId,
      groupName: tag.name,
      emoji: tag.emoji,
      color: tag.color,
      currency: tag.currency,
      title: g.title,
      month: Math.min(Math.max(cur, 1), months),
      months,
      myTurn: position,
      myTurnMonth: addMonths(g.startMonth, position - 1),
      pot: g.amountMinor * months,
      due: due && due.position <= Math.max(cur, 1) ? { paymentId: due.id, amount: due.amountMinor, dueAt: due.dueAt, late: due.dueAt < now } : null,
    });
  }
  return { gameya: out };
});

/** Confirms one share (by the receiver, or by the payment gateway); the last share completes the month's payout. */
export async function confirmShare(tx: DbOrTx, deps: Deps, paymentId: string, by: string) {
  const [p] = await tx.select().from(gameyaPayments).where(eq(gameyaPayments.id, paymentId)).for('update');
  const [slot] = await tx.select().from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, p.gameyaId), eq(gameyaSlots.position, p.position))).for('update');
  if (p.confirmedAt) return { complete: !!slot.receivedAt };
  const now = deps.clock();
  await tx.update(gameyaPayments).set({ confirmedAt: now, confirmedBy: by }).where(eq(gameyaPayments.id, p.id));
  const open = await tx.select({ id: gameyaPayments.id }).from(gameyaPayments).where(and(eq(gameyaPayments.gameyaId, p.gameyaId), eq(gameyaPayments.position, p.position), isNull(gameyaPayments.confirmedAt)));
  if (open.length) return { complete: false };
  await tx.update(gameyaSlots).set({ receivedAt: now }).where(and(eq(gameyaSlots.gameyaId, p.gameyaId), eq(gameyaSlots.position, p.position)));
  const left = await tx.select({ p: gameyaSlots.position }).from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, p.gameyaId), isNull(gameyaSlots.receivedAt)));
  if (!left.length) await tx.update(gameyas).set({ status: 'done' }).where(eq(gameyas.id, p.gameyaId));
  await logActivity(tx, { groupId: p.groupId, actorId: by === 'gateway' ? null : by, verb: 'received', entity: 'gameya', entityId: p.gameyaId, summary: `month ${p.position}` });
  return { complete: true };
}

export function registerGameyaRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';
  const mod = { module: 'gameya', tags: ['gameya'] };

  async function load(c: Ctx) {
    const [g] = await db.select().from(gameyas).where(and(eq(gameyas.id, c.req.param('gameyaId')!), eq(gameyas.groupId, c.get('group').id)));
    if (!g) throw notFound();
    return g;
  }

  async function adultIds(groupId: string) {
    return (await db.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).filter((m) => ADULT.includes(m.role)).map((m) => m.u);
  }

  async function organizers(groupId: string) {
    return (await db.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).filter((m) => ['owner', 'admin'].includes(m.role)).map((m) => m.u);
  }

  r.get(`${base}/gameyas`, { ...mod, perm: 'money.read', summary: 'Gam’eya rounds in this group' }, async (c) => {
    const group = c.get('group');
    const rows = await db.select().from(gameyas).where(eq(gameyas.groupId, group.id)).orderBy(desc(gameyas.createdAt));
    const slots = rows.length ? await db.select().from(gameyaSlots).where(inArray(gameyaSlots.gameyaId, rows.map((g) => g.id))) : [];
    const me = c.get('user').id;
    return rows.map((g) => {
      const mine = slots.filter((s) => s.gameyaId === g.id);
      return { ...g, months: mine.length, pot: g.amountMinor * mine.length, current: currentPosition(g, deps.clock(), group.timezone), myTurn: mine.find((s) => s.userId === me)?.position ?? null };
    });
  });

  r.post(`${base}/gameyas`, { ...mod, perm: 'approve', summary: 'Start a round (agreed order, or drawn by the server)', body: schemas.gameyaCreate }, async (c, { body }) => {
    const group = c.get('group');
    const adults = await adultIds(group.id);
    if (new Set(body.memberIds).size !== body.memberIds.length) throw badRequest('duplicate_member');
    if (body.memberIds.some((u) => !adults.includes(u))) throw badRequest('not_a_member');
    if (monthsBetween(localDayKey(deps.clock().getTime(), group.timezone).slice(0, 7), body.startMonth) < 0) throw badRequest('start_in_past');
    const order = body.orderMode === 'drawn' ? drawOrder(body.memberIds, () => randomInt(0, 2 ** 32) / 2 ** 32) : body.memberIds;
    const g = await db.transaction(async (tx) => {
      const g = await startRound(tx, deps, { groupId: group.id, tz: group.timezone, title: body.title, amountMinor: body.amount, startMonth: body.startMonth, dueDay: body.dueDay, orderMode: body.orderMode, order, userId: c.get('user').id });
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'gameya', entityId: g.id, summary: `${body.title} · ${order.length} × ${fmt(body.amount)}` });
      return g;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'gameya' });
    return { ...g, order };
  });

  r.get(`${base}/gameyas/:gameyaId`, { ...mod, perm: 'money.read', summary: 'Payment board, payout order, swaps, ledger and trust record' }, async (c) => {
    const group = c.get('group');
    const g = await load(c);
    const slots = await db.select().from(gameyaSlots).where(eq(gameyaSlots.gameyaId, g.id)).orderBy(asc(gameyaSlots.position));
    const payments = await db.select().from(gameyaPayments).where(eq(gameyaPayments.gameyaId, g.id)).orderBy(asc(gameyaPayments.position));
    const swaps = await db.select().from(gameyaSwaps).where(eq(gameyaSwaps.gameyaId, g.id)).orderBy(desc(gameyaSwaps.createdAt));
    const now = deps.clock();
    const status = (p: typeof gameyaPayments.$inferSelect) => (p.confirmedAt ? 'paid' : p.reportedAt ? 'reported' : p.dueAt < now ? 'late' : 'due');
    const months = slots.map((s) => {
      const ps = payments.filter((p) => p.position === s.position);
      const paidIn = ps.filter((p) => p.confirmedAt).reduce((t, p) => t + p.amountMinor, 0);
      return {
        position: s.position,
        month: addMonths(g.startMonth, s.position - 1),
        receiverId: s.userId,
        dueAt: ps[0]?.dueAt ?? null,
        expected: ps.reduce((t, p) => t + p.amountMinor, 0),
        paidIn,
        /** the receiver holds the pot once every share is confirmed */
        paidOut: s.receivedAt ? paidIn : 0,
        receivedAt: s.receivedAt,
        payments: ps.map((p) => ({ ...p, status: status(p) })),
      };
    });
    // trust record across every round in this group
    const history = await db.select().from(gameyaPayments).where(eq(gameyaPayments.groupId, group.id));
    const trust = slots.map((s) => {
      // shares that fell due or were settled early; a receiver's own share isn't a payment and doesn't count
      const mine = history.filter((p) => p.payerId === s.userId && p.confirmedBy !== p.payerId && (p.dueAt < now || p.confirmedAt));
      const onTime = mine.filter((p) => (p.reportedAt && p.reportedAt <= p.dueAt) || (p.confirmedAt && p.confirmedAt <= p.dueAt)).length;
      return { userId: s.userId, due: mine.length, onTime, late: mine.length - onTime, open: mine.filter((p) => !p.confirmedAt).length };
    });
    return { gameya: g, current: currentPosition(g, now, group.timezone), pot: g.amountMinor * slots.length, months, swaps, trust };
  });

  r.post(`${base}/gameyas/:gameyaId/payments/:paymentId/report`, { ...mod, perm: 'money.read', summary: '"I paid" — waits for this month’s receiver' }, async (c) => {
    const g = await load(c);
    const [p] = await db.select().from(gameyaPayments).where(and(eq(gameyaPayments.id, c.req.param('paymentId')!), eq(gameyaPayments.gameyaId, g.id)));
    if (!p) throw notFound();
    if (p.payerId !== c.get('user').id) throw forbidden();
    if (p.confirmedAt) return { ok: true };
    const [slot] = await db.select().from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, g.id), eq(gameyaSlots.position, p.position)));
    await db.transaction(async (tx) => {
      await tx.update(gameyaPayments).set({ reportedAt: deps.clock() }).where(eq(gameyaPayments.id, p.id));
      await notify(tx, { userIds: [slot.userId], groupId: g.groupId, kind: 'gameya_paid', title: `💰 ${g.title}`, body: `${c.get('member').displayName} says they paid ${fmt(p.amountMinor)}`, data: { gameyaId: g.id, paymentId: p.id, category: 'settle' }, now: deps.clock() });
    });
    emit(c, { type: 'invalidate', groupId: g.groupId, entity: 'gameya' });
    return { ok: true };
  });

  r.post(`${base}/gameyas/:gameyaId/payments/:paymentId/confirm`, { ...mod, perm: 'money.read', summary: 'The month’s receiver confirms a share; the last share completes the payout' }, async (c) => {
    const g = await load(c);
    const user = c.get('user');
    const res = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(gameyaPayments).where(and(eq(gameyaPayments.id, c.req.param('paymentId')!), eq(gameyaPayments.gameyaId, g.id))).for('update');
      if (!p) throw notFound();
      const [slot] = await tx.select().from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, g.id), eq(gameyaSlots.position, p.position)));
      if (slot.userId !== user.id) throw forbidden('only_the_receiver_confirms');
      return confirmShare(tx, deps, p.id, user.id);
    });
    emit(c, { type: 'invalidate', groupId: g.groupId, entity: 'gameya' });
    return res;
  });

  // ── swaps: the requester, the other member and an organizer must all agree ─────────────
  r.post(`${base}/gameyas/:gameyaId/swaps`, { ...mod, perm: 'money.read', summary: 'Ask another member to swap turns', body: schemas.gameyaSwapCreate }, async (c, { body }) => {
    const group = c.get('group');
    const g = await load(c);
    const user = c.get('user');
    if (g.status !== 'active') throw conflict('round_closed');
    const order = await orderOf(db, g.id);
    swapTurnsOrThrow(order, user.id, body.otherId);
    const cur = currentPosition(g, deps.clock(), group.timezone);
    if (order.indexOf(user.id) + 1 <= cur || order.indexOf(body.otherId) + 1 <= cur) throw conflict('turn_already_started');
    const open = await db.select().from(gameyaSwaps).where(and(eq(gameyaSwaps.gameyaId, g.id), eq(gameyaSwaps.status, 'pending'), eq(gameyaSwaps.requesterId, user.id)));
    if (open.length) throw conflict('swap_pending');
    const iOrganize = actorCan(c, 'approve');
    const orgs = (await organizers(group.id)).filter((u) => u !== user.id);
    const [s] = await db.transaction(async (tx) => {
      const row = await tx
        .insert(gameyaSwaps)
        .values({ id: newId(), gameyaId: g.id, groupId: group.id, requesterId: user.id, otherId: body.otherId, organizerId: iOrganize ? user.id : null, organizerApprovedAt: iOrganize ? deps.clock() : null, createdAt: deps.clock() })
        .returning();
      await notify(tx, { userIds: [body.otherId, ...(iOrganize ? [] : orgs)], groupId: group.id, kind: 'gameya_swap', title: `💰 ${g.title}`, body: `${c.get('member').displayName} asks to swap turns (month ${order.indexOf(user.id) + 1} ↔ ${order.indexOf(body.otherId) + 1})`, data: { gameyaId: g.id, swapId: row[0].id }, now: deps.clock() });
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'gameya' });
    return s;
  });

  async function decide(c: Ctx, action: 'accept' | 'approve' | 'reject') {
    const group = c.get('group');
    const g = await load(c);
    const user = c.get('user');
    const result = await db.transaction(async (tx) => {
      const [s] = await tx.select().from(gameyaSwaps).where(and(eq(gameyaSwaps.id, c.req.param('swapId')!), eq(gameyaSwaps.gameyaId, g.id))).for('update');
      if (!s) throw notFound();
      if (s.status !== 'pending') throw conflict('swap_closed');
      const isOther = s.otherId === user.id;
      const isOrganizer = actorCan(c, 'approve');
      const now = deps.clock();
      if (action === 'reject') {
        if (!isOther && !isOrganizer && s.requesterId !== user.id) throw forbidden();
        await tx.update(gameyaSwaps).set({ status: s.requesterId === user.id ? 'cancelled' : 'rejected', doneAt: now }).where(eq(gameyaSwaps.id, s.id));
        return { status: s.requesterId === user.id ? 'cancelled' : 'rejected' };
      }
      const patch: Partial<typeof gameyaSwaps.$inferInsert> = {};
      if (action === 'accept') {
        if (!isOther) throw forbidden('only_the_other_member_accepts');
        patch.otherAcceptedAt = now;
        // an organizer who is the other member covers both approvals
        if (isOrganizer && !s.organizerApprovedAt) Object.assign(patch, { organizerId: user.id, organizerApprovedAt: now });
      } else {
        if (!isOrganizer) throw forbidden('only_an_organizer_approves');
        Object.assign(patch, { organizerId: user.id, organizerApprovedAt: now });
      }
      const next = { ...s, ...patch };
      if (!(next.otherAcceptedAt && next.organizerApprovedAt)) {
        await tx.update(gameyaSwaps).set(patch).where(eq(gameyaSwaps.id, s.id));
        return { status: 'pending' };
      }
      // everyone agreed: swap the two slots (still both in the future, and nothing paid to either yet)
      const slots = await tx.select().from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, g.id), inArray(gameyaSlots.userId, [s.requesterId, s.otherId]))).for('update');
      const a = slots.find((x) => x.userId === s.requesterId);
      const b = slots.find((x) => x.userId === s.otherId);
      const cur = currentPosition(g, now, group.timezone);
      if (!a || !b || a.position <= cur || b.position <= cur || a.receivedAt || b.receivedAt) throw conflict('turn_already_started');
      const confirmedShares = await tx
        .select()
        .from(gameyaPayments)
        .where(and(eq(gameyaPayments.gameyaId, g.id), inArray(gameyaPayments.position, [a.position, b.position]), isNotNull(gameyaPayments.confirmedAt)));
      if (confirmedShares.some((p) => p.payerId !== (p.position === a.position ? a.userId : b.userId))) throw conflict('shares_already_confirmed');
      const order = swapTurns(await orderOf(tx, g.id), s.requesterId, s.otherId);
      await tx.delete(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, g.id), inArray(gameyaSlots.position, [a.position, b.position])));
      await tx.insert(gameyaSlots).values([
        { gameyaId: g.id, groupId: g.groupId, position: a.position, userId: s.otherId },
        { gameyaId: g.id, groupId: g.groupId, position: b.position, userId: s.requesterId },
      ]);
      // the receiver's own share never leaves their hands: move the auto-confirmation with the turn
      for (const [pos, receiver] of [
        [a.position, s.otherId],
        [b.position, s.requesterId],
      ] as const) {
        await tx.update(gameyaPayments).set({ confirmedAt: null, confirmedBy: null }).where(and(eq(gameyaPayments.gameyaId, g.id), eq(gameyaPayments.position, pos)));
        await tx.update(gameyaPayments).set({ confirmedAt: now, confirmedBy: receiver }).where(and(eq(gameyaPayments.gameyaId, g.id), eq(gameyaPayments.position, pos), eq(gameyaPayments.payerId, receiver)));
      }
      await tx.update(gameyaSwaps).set({ ...patch, status: 'done', doneAt: now }).where(eq(gameyaSwaps.id, s.id));
      await logActivity(tx, { groupId: g.groupId, actorId: user.id, verb: 'swapped', entity: 'gameya', entityId: g.id, summary: `month ${a.position} ↔ ${b.position}` });
      await notify(tx, { userIds: [s.requesterId, s.otherId], groupId: g.groupId, kind: 'gameya_swap', title: `💰 ${g.title}`, body: `Turns swapped: month ${a.position} ↔ ${b.position}`, data: { gameyaId: g.id }, now });
      return { status: 'done', order };
    });
    emit(c, { type: 'invalidate', groupId: g.groupId, entity: 'gameya' });
    return result;
  }
  r.post(`${base}/gameyas/:gameyaId/swaps/:swapId/accept`, { ...mod, perm: 'money.read', summary: 'The other member agrees to swap' }, (c) => decide(c, 'accept'));
  r.post(`${base}/gameyas/:gameyaId/swaps/:swapId/approve`, { ...mod, perm: 'approve', summary: 'An organizer approves the swap' }, (c) => decide(c, 'approve'));
  r.post(`${base}/gameyas/:gameyaId/swaps/:swapId/reject`, { ...mod, perm: 'money.read', summary: 'Decline (other member / organizer) or withdraw (requester)' }, (c) => decide(c, 'reject'));

  r.post(`${base}/gameyas/:gameyaId/next-round`, { ...mod, perm: 'approve', summary: 'Run the circle again with the same members (drawn again if it was drawn)' }, async (c) => {
    const group = c.get('group');
    const g = await load(c);
    if (g.status !== 'done') throw conflict('round_not_finished');
    const prev = await orderOf(db, g.id);
    const adults = await adultIds(group.id);
    const members = prev.filter((u) => adults.includes(u));
    if (members.length < 2) throw badRequest('need_two_members');
    const order = g.orderMode === 'drawn' ? drawOrder(members, () => randomInt(0, 2 ** 32) / 2 ** 32) : members;
    const startMonth = addMonths(g.startMonth, prev.length);
    const thisMonth = localDayKey(deps.clock().getTime(), group.timezone).slice(0, 7);
    const next = await db.transaction((tx) =>
      startRound(tx, deps, { groupId: group.id, tz: group.timezone, title: g.title, amountMinor: g.amountMinor, startMonth: monthsBetween(thisMonth, startMonth) < 0 ? thisMonth : startMonth, dueDay: g.dueDay, orderMode: g.orderMode, order, userId: c.get('user').id, round: g.round + 1, previousId: g.id }),
    );
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'gameya' });
    return { ...next, order };
  });
}

function swapTurnsOrThrow(order: string[], a: string, b: string) {
  try {
    return swapTurns(order, a, b);
  } catch {
    throw badRequest('not_in_this_round');
  }
}
