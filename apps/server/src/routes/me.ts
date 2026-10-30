import { can, schemas, simplifyDebts, type Role } from '@circle/shared';
import { and, asc, desc, eq, inArray, isNull, lte, notExists, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { announcementReads, groupMembers, groups, messages, notifications, pushTokens, settlements, tasks, users } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity } from '../effects';
import { HttpError } from '../errors';
import { emitUser, type Router } from '../http';
import { newId } from '../ids';
import { ensureMaterialized } from '../services/events';
import { listOccurrences } from './events';
import { groupLedger } from './expenses';

type MyGroup = { id: string; name: string; emoji: string; color: string; type: string; currency: string; role: Role; modules: string[] };

export async function myGroups(db: DbOrTx, userId: string): Promise<MyGroup[]> {
  const rows = await db
    .select({ id: groups.id, name: groups.name, emoji: groups.emoji, color: groups.color, type: groups.type, currency: groups.currency, modules: groups.modules, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

/** Hooks for later versions to add sections to Today (rent due, gam'eya turn, dues…). */
export const todaySections: ((db: DbOrTx, deps: Deps, a: { userId: string; groups: MyGroup[]; now: Date }) => Promise<Record<string, unknown>>)[] = [];

/** Deleting an account: owned groups pass to the oldest admin (then the oldest adult member), or are deleted when empty. */
export async function deleteAccount(db: DbOrTx, userId: string) {
  const owned = await db.select().from(groupMembers).where(and(eq(groupMembers.userId, userId), eq(groupMembers.role, 'owner')));
  for (const m of owned) {
    const others = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, m.groupId), sql`${groupMembers.userId} <> ${userId}`))
      .orderBy(asc(groupMembers.joinedAt));
    const heir = others.find((o) => o.role === 'admin') ?? others.find((o) => o.role === 'manager') ?? others.find((o) => o.role === 'member');
    if (heir) {
      await db.update(groupMembers).set({ role: 'owner' }).where(and(eq(groupMembers.groupId, m.groupId), eq(groupMembers.userId, heir.userId)));
      await logActivity(db, { groupId: m.groupId, actorId: null, verb: 'transferred', entity: 'group', entityId: heir.userId, summary: 'previous owner deleted their account' });
    } else {
      await db.delete(groups).where(eq(groups.id, m.groupId));
    }
  }
  // memberships, sessions, accounts, push tokens and notifications cascade from users
  await db.delete(users).where(eq(users.id, userId));
}

export function registerMeRoutes(r: Router, deps: Deps) {
  const { db } = deps;

  r.get('/me', { tags: ['me'], summary: 'My profile' }, async (c) => {
    const [me] = await db.select().from(users).where(eq(users.id, c.get('user').id));
    return me;
  });

  r.patch('/me', { tags: ['me'], summary: 'Update profile (name, photo, language, digits, timezone)', body: schemas.profileUpdate }, async (c, { body }) => {
    const [me] = await db.update(users).set({ ...body, updatedAt: deps.clock() }).where(eq(users.id, c.get('user').id)).returning();
    return me;
  });

  r.delete('/me', { tags: ['me'], summary: 'Delete my account' }, async (c) => {
    if (c.get('user').isChild) throw new HttpError(403, 'ask_a_parent');
    const userId = c.get('user').id;
    const gs = await myGroups(db, userId);
    await db.transaction((tx) => deleteAccount(tx, userId));
    for (const g of gs) emitUser(c, userId, { type: 'membership', groupId: g.id });
    return { ok: true };
  });

  r.get('/me/export', { tags: ['me'], summary: 'Export my data' }, async (c) => {
    const userId = c.get('user').id;
    const [me] = await db.select().from(users).where(eq(users.id, userId));
    const memberships = await db.select().from(groupMembers).where(eq(groupMembers.userId, userId));
    const myTasks = await db.select().from(tasks).where(eq(tasks.assigneeId, userId));
    const myMessages = await db.select().from(messages).where(eq(messages.userId, userId));
    return { exportedAt: deps.clock(), profile: me, memberships, tasks: myTasks, messages: myMessages };
  });

  r.get('/me/today', { tags: ['me'], summary: 'Today across all my groups' }, async (c) => {
    const userId = c.get('user').id;
    const now = deps.clock();
    const gs = await myGroups(db, userId);
    const ids = gs.map((g) => g.id);
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const tag = (groupId: string) => {
      const g = gs.find((x) => x.id === groupId)!;
      return { groupId, groupName: g.name, groupEmoji: g.emoji, groupColor: g.color, groupType: g.type };
    };
    const taskGroups = gs.filter((g) => g.modules.includes('tasks')).map((g) => g.id);
    const myTasks = taskGroups.length
      ? await db
          .select()
          .from(tasks)
          .where(and(inArray(tasks.groupId, taskGroups), eq(tasks.assigneeId, userId), eq(tasks.status, 'open'), lte(tasks.dueAt, weekAhead)))
          .orderBy(asc(tasks.dueAt))
      : [];
    const eventGroups = gs.filter((g) => g.modules.includes('events')).map((g) => g.id);
    await ensureMaterialized(db, eventGroups, now);
    const upcoming = await listOccurrences(db, eventGroups, userId, new Date(now.getTime() - 3 * 3600_000), weekAhead);

    const money: { groupId: string; currency: string; net: number; owe: { to: string; amount: number }[]; owed: { from: string; amount: number }[] }[] = [];
    const toConfirm: (typeof settlements.$inferSelect)[] = [];
    for (const g of gs) {
      if (!g.modules.includes('expenses') || !can(g.role, 'money.read')) continue;
      const { balances, settlements: setts } = await groupLedger(db, g.id);
      const net = balances[userId] ?? 0;
      const transfers = simplifyDebts(balances);
      toConfirm.push(...setts.filter((s) => s.toId === userId && !s.confirmedAt));
      if (net !== 0) {
        money.push({
          groupId: g.id,
          currency: g.currency,
          net,
          owe: transfers.filter((t) => t.from === userId).map((t) => ({ to: t.to, amount: t.amount })),
          owed: transfers.filter((t) => t.to === userId).map((t) => ({ from: t.from, amount: t.amount })),
        });
      }
    }
    const names = ids.length ? await db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId, name: groupMembers.displayName }).from(groupMembers).where(inArray(groupMembers.groupId, ids)) : [];
    const nameOf = (groupId: string, uid: string) => names.find((n) => n.groupId === groupId && n.userId === uid)?.name ?? '—';

    const unread = ids.length
      ? await db
          .select()
          .from(messages)
          .where(
            and(
              inArray(messages.groupId, ids),
              eq(messages.pinned, true),
              isNull(messages.deletedAt),
              sql`${messages.userId} <> ${userId}`,
              notExists(db.select().from(announcementReads).where(and(eq(announcementReads.messageId, messages.id), eq(announcementReads.userId, userId)))),
            ),
          )
          .orderBy(desc(messages.pinnedAt))
          .limit(20)
      : [];

    const extra: Record<string, unknown> = {};
    for (const section of todaySections) Object.assign(extra, await section(db, deps, { userId, groups: gs, now }));

    return {
      now,
      tasks: myTasks.map((t) => ({ ...t, ...tag(t.groupId), overdue: !!t.dueAt && t.dueAt < now })),
      events: upcoming.map((e) => ({ ...e, ...tag(e.groupId) })),
      money: money.map((m) => ({
        ...m,
        ...tag(m.groupId),
        owe: m.owe.map((o) => ({ ...o, name: nameOf(m.groupId, o.to) })),
        owed: m.owed.map((o) => ({ ...o, name: nameOf(m.groupId, o.from) })),
      })),
      toConfirm: toConfirm.map((s) => ({ ...s, ...tag(s.groupId), fromName: nameOf(s.groupId, s.fromId) })),
      announcements: unread.map((m) => ({ ...m, ...tag(m.groupId), authorName: nameOf(m.groupId, m.userId) })),
      ...extra,
    };
  });

  r.get('/me/inbox', { tags: ['me'], summary: 'Mentions, assignments, confirmations', query: z.object({ groupId: z.string().optional() }) }, async (c, { query }) => {
    const conds = [eq(notifications.userId, c.get('user').id)];
    if (query.groupId) conds.push(eq(notifications.groupId, query.groupId));
    return db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.createdAt)).limit(100);
  });

  r.post('/me/inbox/read', { tags: ['me'], summary: 'Mark notifications read', body: z.object({ ids: z.array(z.string()).max(200).optional() }) }, async (c, { body }) => {
    const conds = [eq(notifications.userId, c.get('user').id), isNull(notifications.readAt)];
    if (body.ids) conds.push(inArray(notifications.id, body.ids));
    await db.update(notifications).set({ readAt: deps.clock() }).where(and(...conds));
    return { ok: true };
  });

  r.post('/me/push-tokens', { tags: ['me'], summary: 'Register an Expo push token', body: schemas.pushTokenRegister }, async (c, { body }) => {
    await db
      .insert(pushTokens)
      .values({ id: newId(), userId: c.get('user').id, token: body.token, platform: body.platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId: c.get('user').id } });
    return { ok: true };
  });

  r.delete('/me/push-tokens/:token', { tags: ['me'], summary: 'Unregister a push token' }, async (c) => {
    await db.delete(pushTokens).where(and(eq(pushTokens.token, c.req.param('token')!), eq(pushTokens.userId, c.get('user').id)));
    return { ok: true };
  });
}
