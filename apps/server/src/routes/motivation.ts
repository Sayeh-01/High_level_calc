import { computeStreak, fairnessShares, localDayKey, schemas } from '@circle/shared';
import { and, desc, eq, gte, inArray, sum } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { groupMembers, groups, pointsLedger, redemptions, rewards, taskCompletions } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';
import { onTaskCompleted } from './tasks';

/** Every ledger row is stamped with the app clock (logic compares it with the group's local month and day). */
async function addPoints(tx: DbOrTx, deps: Deps, row: { groupId: string; userId: string; delta: number; reason: string; refId?: string | null }) {
  await tx.insert(pointsLedger).values({ id: newId(), refId: null, ...row, createdAt: deps.clock() });
}

export async function pointsBalance(tx: DbOrTx, groupId: string, userId: string): Promise<number> {
  const [row] = await tx.select({ total: sum(pointsLedger.delta) }).from(pointsLedger).where(and(eq(pointsLedger.groupId, groupId), eq(pointsLedger.userId, userId)));
  return Number(row?.total ?? 0);
}

async function approverIds(tx: DbOrTx, groupId: string) {
  return (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId)))
    .filter((m) => ['owner', 'admin', 'manager'].includes(m.role))
    .map((m) => m.u);
}

// Completing a chore earns its points. A Child's completion waits for a parent (A6 "parent approval").
onTaskCompleted.push(async (tx, deps, { task, userId, completionId }) => {
  const [member] = await tx.select().from(groupMembers).where(and(eq(groupMembers.groupId, task.groupId), eq(groupMembers.userId, userId)));
  const [group] = await tx.select().from(groups).where(eq(groups.id, task.groupId));
  const needsApproval = member?.role === 'child' && (group?.settings as any)?.childApproval !== false;
  if (needsApproval) {
    await tx.update(taskCompletions).set({ status: 'pending' }).where(eq(taskCompletions.id, completionId));
    await notify(tx, { userIds: await approverIds(tx, task.groupId), groupId: task.groupId, kind: 'approval', title: `✓ ${task.title}`, body: `${member.displayName} finished a chore. Approve?`, data: { completionId, href: `/g/${task.groupId}/points` }, now: deps.clock() });
    return;
  }
  if (task.points > 0) await addPoints(tx, deps, { groupId: task.groupId, userId, delta: task.points, reason: 'task', refId: completionId });
});

export function registerMotivationRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const mod = { module: 'points', tags: ['points'] };
  const base = '/groups/:groupId';

  r.get(`${base}/points`, { ...mod, perm: 'items.read', summary: 'Balances, this month’s fairness meter and streaks' }, async (c) => {
    const group = c.get('group');
    const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const ledger = await db.select().from(pointsLedger).where(eq(pointsLedger.groupId, group.id));
    const balances: Record<string, number> = Object.fromEntries(members.map((m) => [m.userId, 0]));
    for (const l of ledger) balances[l.userId] = (balances[l.userId] ?? 0) + l.delta;
    // fairness: share of chore points earned this calendar month (group timezone)
    const monthPrefix = localDayKey(deps.clock().getTime(), group.timezone).slice(0, 7);
    const earned: Record<string, number> = Object.fromEntries(members.map((m) => [m.userId, 0]));
    for (const l of ledger) if (l.reason === 'task' && localDayKey(l.createdAt.getTime(), group.timezone).startsWith(monthPrefix)) earned[l.userId] = (earned[l.userId] ?? 0) + l.delta;
    const since = new Date(deps.clock().getTime() - 120 * 86_400_000);
    const done = await db.select({ userId: taskCompletions.userId, at: taskCompletions.completedAt, status: taskCompletions.status }).from(taskCompletions).where(and(eq(taskCompletions.groupId, group.id), gte(taskCompletions.completedAt, since)));
    const streaks = Object.fromEntries(
      members.map((m) => [m.userId, computeStreak(done.filter((d) => d.userId === m.userId && d.status !== 'rejected').map((d) => d.at.getTime()), group.timezone, deps.clock().getTime())]),
    );
    const me = c.get('user').id;
    return { balances, earnedThisMonth: earned, fairness: fairnessShares(earned), streaks, me: { balance: balances[me] ?? 0, streak: streaks[me] ?? 0 } };
  });

  r.get(`${base}/points/history`, { ...mod, perm: 'items.read', summary: 'My points history (approvers see everyone)' }, async (c) => {
    const group = c.get('group');
    const conds = [eq(pointsLedger.groupId, group.id)];
    if (!actorCan(c, 'approve')) conds.push(eq(pointsLedger.userId, c.get('user').id));
    return db.select().from(pointsLedger).where(and(...conds)).orderBy(desc(pointsLedger.createdAt)).limit(200);
  });

  r.post(`${base}/points/adjust`, { ...mod, perm: 'approve', summary: 'Give or take points by hand', body: schemas.pointsAdjust }, async (c, { body }) => {
    const group = c.get('group');
    const [m] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, body.userId)));
    if (!m) throw badRequest('not_a_member');
    await db.transaction(async (tx) => {
      await tx.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, body.userId))).for('update');
      if (body.delta < 0 && (await pointsBalance(tx, group.id, body.userId)) + body.delta < 0) throw conflict('insufficient_points');
      await addPoints(tx, deps, { groupId: group.id, userId: body.userId, delta: body.delta, reason: 'adjust', refId: body.note ?? null });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'points' });
    return { balance: await pointsBalance(db, group.id, body.userId) };
  });

  // ── rewards shop ────────────────────────────────────────────────────────────
  r.get(`${base}/rewards`, { ...mod, perm: 'items.read', summary: 'Rewards shop' }, async (c) => {
    return db.select().from(rewards).where(and(eq(rewards.groupId, c.get('group').id), eq(rewards.active, true))).orderBy(rewards.cost);
  });

  r.post(`${base}/rewards`, { ...mod, perm: 'approve', summary: 'Add a reward', body: schemas.rewardCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.insert(rewards).values({ id: newId(), groupId: group.id, title: body.title, cost: body.cost, emoji: body.emoji ?? '🎁', createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'rewards' });
    return row;
  });

  r.delete(`${base}/rewards/:rewardId`, { ...mod, perm: 'approve', summary: 'Remove a reward' }, async (c) => {
    const group = c.get('group');
    const res = await db.update(rewards).set({ active: false }).where(and(eq(rewards.id, c.req.param('rewardId')!), eq(rewards.groupId, group.id))).returning();
    if (!res.length) throw notFound();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'rewards' });
    return { ok: true };
  });

  /**
   * Redeeming locks the member row first, so two redemptions at once are serialized and the second sees the reduced
   * balance: points can never go below 0 (B9 v1.2).
   */
  r.post(`${base}/rewards/:rewardId/redeem`, { ...mod, perm: 'items.read', summary: 'Spend points on a reward' }, async (c) => {
    const group = c.get('group');
    const user = c.get('user');
    const row = await db.transaction(async (tx) => {
      const [reward] = await tx.select().from(rewards).where(and(eq(rewards.id, c.req.param('rewardId')!), eq(rewards.groupId, group.id), eq(rewards.active, true)));
      if (!reward) throw notFound();
      await tx.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, user.id))).for('update');
      const balance = await pointsBalance(tx, group.id, user.id);
      if (balance < reward.cost) throw conflict('insufficient_points', `You have ${balance} points; this costs ${reward.cost}`);
      const id = newId();
      await tx.insert(redemptions).values({ id, groupId: group.id, rewardId: reward.id, userId: user.id, cost: reward.cost });
      await addPoints(tx, deps, { groupId: group.id, userId: user.id, delta: -reward.cost, reason: 'redeem', refId: id });
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'redeemed', entity: 'reward', entityId: reward.id, summary: reward.title });
      await notify(tx, { userIds: await approverIds(tx, group.id), exclude: user.id, groupId: group.id, kind: 'redemption', title: `${reward.emoji} ${reward.title}`, body: `${c.get('member').displayName} spent ${reward.cost} points`, data: { redemptionId: id, href: `/g/${group.id}/points` }, now: deps.clock() });
      return { id, balance: balance - reward.cost };
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'points' });
    return row;
  });

  r.get(`${base}/redemptions`, { ...mod, perm: 'items.read', summary: 'Redemptions (mine; approvers see all)' }, async (c) => {
    const group = c.get('group');
    const conds = [eq(redemptions.groupId, group.id)];
    if (!actorCan(c, 'approve')) conds.push(eq(redemptions.userId, c.get('user').id));
    const rows = await db.select({ r: redemptions, title: rewards.title, emoji: rewards.emoji }).from(redemptions).innerJoin(rewards, eq(rewards.id, redemptions.rewardId)).where(and(...conds)).orderBy(desc(redemptions.createdAt)).limit(100);
    return rows.map((x) => ({ ...x.r, title: x.title, emoji: x.emoji }));
  });

  for (const action of ['fulfill', 'cancel'] as const) {
    r.post(`${base}/redemptions/:redemptionId/${action}`, { ...mod, perm: 'items.read', summary: action === 'fulfill' ? 'Mark a reward given' : 'Cancel and refund' }, async (c) => {
      const group = c.get('group');
      const user = c.get('user');
      await db.transaction(async (tx) => {
        const [red] = await tx.select().from(redemptions).where(and(eq(redemptions.id, c.req.param('redemptionId')!), eq(redemptions.groupId, group.id))).for('update');
        if (!red) throw notFound();
        const own = red.userId === user.id;
        if (!actorCan(c, 'approve') && !(own && action === 'cancel')) throw forbidden();
        if (red.status !== 'pending') return;
        await tx.update(redemptions).set({ status: action === 'fulfill' ? 'fulfilled' : 'cancelled', resolvedAt: deps.clock(), resolvedBy: user.id }).where(eq(redemptions.id, red.id));
        if (action === 'cancel') await addPoints(tx, deps, { groupId: group.id, userId: red.userId, delta: red.cost, reason: 'refund', refId: red.id });
      });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'points' });
      return { ok: true };
    });
  }

  // ── chore approvals (Kids mode) ─────────────────────────────────────────────
  r.get(`${base}/approvals`, { module: 'tasks', tags: ['points'], perm: 'approve', summary: 'Chores waiting for approval' }, async (c) => {
    return db.select().from(taskCompletions).where(and(eq(taskCompletions.groupId, c.get('group').id), eq(taskCompletions.status, 'pending'))).orderBy(desc(taskCompletions.completedAt));
  });

  for (const action of ['approve', 'reject'] as const) {
    r.post(`${base}/completions/:completionId/${action}`, { module: 'tasks', tags: ['points'], perm: 'approve', summary: `${action} a completed chore` }, async (c) => {
      const group = c.get('group');
      await db.transaction(async (tx) => {
        const [comp] = await tx.select().from(taskCompletions).where(and(eq(taskCompletions.id, c.req.param('completionId')!), eq(taskCompletions.groupId, group.id))).for('update');
        if (!comp) throw notFound();
        if (comp.status !== 'pending') return;
        await tx.update(taskCompletions).set({ status: action === 'approve' ? 'approved' : 'rejected', reviewedBy: c.get('user').id }).where(eq(taskCompletions.id, comp.id));
        if (action === 'approve' && comp.points > 0) await addPoints(tx, deps, { groupId: group.id, userId: comp.userId, delta: comp.points, reason: 'task', refId: comp.id });
        await notify(tx, { userIds: [comp.userId], groupId: group.id, kind: `chore_${action}d`, title: action === 'approve' ? `⭐ +${comp.points}` : 'Try again', body: action === 'approve' ? 'Your chore was approved' : 'Your chore was not approved', data: { href: `/g/${group.id}/points` }, now: deps.clock() });
      });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'points' });
      return { ok: true };
    });
  }
}

export async function pendingApprovalCount(db: DbOrTx, groupIds: string[]) {
  if (!groupIds.length) return 0;
  const rows = await db.select({ id: taskCompletions.id }).from(taskCompletions).where(and(inArray(taskCompletions.groupId, groupIds), eq(taskCompletions.status, 'pending')));
  return rows.length;
}
