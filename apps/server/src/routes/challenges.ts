import { assignParts, computeStreak, fromZoned, localDayKey, partRanges, schemas } from '@circle/shared';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { challengeLogs, challengeParts, challenges, groupMembers } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';

// Challenges (A7, B9 v2.8): split a goal into parts that rotate each round (khatma: 30 juz'), or a daily target with streaks.

type Challenge = typeof challenges.$inferSelect;

/** "Juz' 1–8" style summary of someone's parts. */
function partsText(label: string, parts: number[]) {
  return parts.length ? `${label} ${partRanges(parts)}` : '';
}

/** Writes a round's parts (rotated) and tells everyone what they read this round. */
async function startRound(tx: DbOrTx, deps: Deps, ch: Challenge, round: number) {
  const plan = assignParts(ch.totalParts!, ch.memberIds, round);
  await tx.insert(challengeParts).values(plan.map((p) => ({ challengeId: ch.id, groupId: ch.groupId, round, part: p.part, userId: p.userId })));
  await tx.update(challenges).set({ round }).where(eq(challenges.id, ch.id));
  for (const userId of ch.memberIds) {
    const mine = plan.filter((p) => p.userId === userId).map((p) => p.part);
    if (!mine.length) continue;
    await notify(tx, { userIds: [userId], groupId: ch.groupId, kind: 'challenge_parts', title: `🏁 ${ch.title}${round > 1 ? ` · round ${round}` : ''}`, body: `Yours: ${partsText(ch.partLabel ?? 'Part', mine)}`, data: { challengeId: ch.id, href: `/g/${ch.groupId}/challenge/${ch.id}` }, now: deps.clock() });
  }
}

export function registerChallengeRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';
  const mod = { module: 'challenges', tags: ['challenges'] };

  async function load(c: Ctx, tx: DbOrTx = db) {
    const [ch] = await tx.select().from(challenges).where(and(eq(challenges.id, c.req.param('challengeId')!), eq(challenges.groupId, c.get('group').id), eq(challenges.status, 'active')));
    if (!ch) throw notFound();
    return ch;
  }
  const canManage = (c: Ctx, ch: Challenge) => ch.createdBy === c.get('user').id || actorCan(c, 'items.manage');

  async function streaks(ch: Challenge, tz: string) {
    const since = localDayKey(deps.clock().getTime() - 60 * 86_400_000, tz);
    const logs = await db.select().from(challengeLogs).where(and(eq(challengeLogs.challengeId, ch.id), gte(challengeLogs.day, since)));
    const users = [...new Set(logs.map((l) => l.userId))];
    const today = localDayKey(deps.clock().getTime(), tz);
    return users
      .map((userId) => {
        const mine = logs.filter((l) => l.userId === userId);
        const hit = mine.filter((l) => l.value >= ch.target!).map((l) => {
          const [y, m, d] = l.day.split('-').map(Number);
          return fromZoned({ year: y, month: m, day: d, hour: 12, minute: 0 }, tz);
        });
        return { userId, streak: computeStreak(hit, tz, deps.clock().getTime()), today: mine.find((l) => l.day === today)?.value ?? 0, days: hit.length };
      })
      .sort((a, b) => b.streak - a.streak || b.today - a.today);
  }

  r.get(`${base}/challenges`, { ...mod, perm: 'items.read', summary: 'Challenges with progress' }, async (c) => {
    const group = c.get('group');
    const rows = await db.select().from(challenges).where(and(eq(challenges.groupId, group.id), eq(challenges.status, 'active'))).orderBy(desc(challenges.createdAt));
    const parts = rows.length ? await db.select().from(challengeParts).where(inArray(challengeParts.challengeId, rows.map((x) => x.id))) : [];
    const me = c.get('user').id;
    return Promise.all(
      rows.map(async (ch) => {
        if (ch.kind === 'tally') {
          const s = await streaks(ch, group.timezone);
          return { ...ch, mine: s.find((x) => x.userId === me) ?? { streak: 0, today: 0 } };
        }
        const cur = parts.filter((p) => p.challengeId === ch.id && p.round === ch.round);
        return { ...ch, done: cur.filter((p) => p.doneAt).length, total: cur.length, myOpen: cur.filter((p) => p.userId === me && !p.doneAt).map((p) => p.part) };
      }),
    );
  });

  r.post(`${base}/challenges`, { ...mod, perm: 'items.create', summary: 'Start a challenge (split goal or daily target)', body: schemas.challengeCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const row = await db.transaction(async (tx) => {
      if (body.kind === 'split') {
        if (new Set(body.memberIds).size !== body.memberIds.length) throw badRequest('duplicate_member');
        const members = (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).filter((m) => m.role !== 'guest').map((m) => m.u);
        if (body.memberIds.some((u) => !members.includes(u))) throw badRequest('not_a_member');
      }
      const [ch] = await tx
        .insert(challenges)
        .values({
          id: newId(),
          groupId: group.id,
          title: body.title,
          kind: body.kind,
          totalParts: body.kind === 'split' ? body.totalParts : null,
          partLabel: body.kind === 'split' ? body.partLabel : null,
          memberIds: body.kind === 'split' ? body.memberIds : [],
          autoNext: body.kind === 'split' ? body.autoNext : false,
          target: body.kind === 'tally' ? body.target : null,
          unit: body.kind === 'tally' ? body.unit : null,
          round: body.kind === 'split' ? 0 : 1,
          createdBy: user.id,
          createdAt: deps.clock(),
        })
        .returning();
      if (ch.kind === 'split') await startRound(tx, deps, ch, 1);
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'created', entity: 'challenge', entityId: ch.id, summary: ch.title });
      return { ...ch, round: ch.kind === 'split' ? 1 : ch.round };
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'challenges' });
    return row;
  });

  r.get(`${base}/challenges/:challengeId`, { ...mod, perm: 'items.read', summary: 'Parts of this round (split) or streaks (tally)' }, async (c) => {
    const group = c.get('group');
    const ch = await load(c);
    if (ch.kind === 'tally') return { challenge: ch, streaks: await streaks(ch, group.timezone) };
    const parts = await db.select().from(challengeParts).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round))).orderBy(asc(challengeParts.part));
    const rounds = await db
      .select({ round: challengeParts.round, open: sql<number>`count(*) filter (where ${challengeParts.doneAt} is null)` })
      .from(challengeParts)
      .where(eq(challengeParts.challengeId, ch.id))
      .groupBy(challengeParts.round);
    return { challenge: ch, parts, completedRounds: rounds.filter((x) => Number(x.open) === 0).length };
  });

  r.post(`${base}/challenges/:challengeId/parts/:part/done`, { ...mod, perm: 'items.read', summary: 'Mark a part done (the last one starts the next, rotated round)' }, async (c) => {
    const user = c.get('user');
    const res = await db.transaction(async (tx) => {
      const ch = await load(c, tx);
      if (ch.kind !== 'split') throw badRequest('not_a_split_challenge');
      const [p] = await tx.select().from(challengeParts).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), eq(challengeParts.part, Number(c.req.param('part'))))).for('update');
      if (!p) throw notFound();
      if (p.userId !== user.id && !canManage(c, ch)) throw forbidden();
      if (p.doneAt) return { round: ch.round, nextRound: false };
      await tx.update(challengeParts).set({ doneAt: deps.clock(), doneBy: user.id }).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), eq(challengeParts.part, p.part)));
      const open = await tx.select({ part: challengeParts.part }).from(challengeParts).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), isNull(challengeParts.doneAt)));
      if (open.length || !ch.autoNext) return { round: ch.round, nextRound: false };
      await logActivity(tx, { groupId: ch.groupId, actorId: user.id, verb: 'completed', entity: 'challenge', entityId: ch.id, summary: `${ch.title} · round ${ch.round}` });
      await startRound(tx, deps, ch, ch.round + 1);
      return { round: ch.round + 1, nextRound: true };
    });
    emit(c, { type: 'invalidate', groupId: c.get('group').id, entity: 'challenges' });
    return res;
  });

  r.post(`${base}/challenges/:challengeId/parts/:part/undo`, { ...mod, perm: 'items.read', summary: 'Un-mark a part of the current round' }, async (c) => {
    const ch = await load(c);
    const [p] = await db.select().from(challengeParts).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), eq(challengeParts.part, Number(c.req.param('part')))));
    if (!p) throw notFound();
    if (p.userId !== c.get('user').id && !canManage(c, ch)) throw forbidden();
    await db.update(challengeParts).set({ doneAt: null, doneBy: null }).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), eq(challengeParts.part, p.part)));
    emit(c, { type: 'invalidate', groupId: ch.groupId, entity: 'challenges' });
    return { ok: true };
  });

  /** Hand a part back (assignee), take an unassigned part (any participant), or assign anyone (manager). */
  r.put(`${base}/challenges/:challengeId/parts/:part`, { ...mod, perm: 'items.read', summary: 'Hand back, take or reassign a part', body: schemas.partAssign }, async (c, { body }) => {
    const ch = await load(c);
    const me = c.get('user').id;
    const [p] = await db.select().from(challengeParts).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), eq(challengeParts.part, Number(c.req.param('part')))));
    if (!p) throw notFound();
    if (p.doneAt) throw conflict('part_done');
    const manager = canManage(c, ch);
    if (body.userId && !ch.memberIds.includes(body.userId)) throw badRequest('not_a_participant');
    const handBack = body.userId === null && p.userId === me;
    const take = body.userId === me && p.userId === null;
    if (!manager && !handBack && !take) throw forbidden();
    await db.update(challengeParts).set({ userId: body.userId }).where(and(eq(challengeParts.challengeId, ch.id), eq(challengeParts.round, ch.round), eq(challengeParts.part, p.part)));
    if (body.userId && body.userId !== me)
      await notify(db, { userIds: [body.userId], groupId: ch.groupId, kind: 'challenge_parts', title: `🏁 ${ch.title}`, body: `You now have ${ch.partLabel ?? 'Part'} ${p.part}`, data: { challengeId: ch.id, href: `/g/${ch.groupId}/challenge/${ch.id}` }, now: deps.clock() });
    emit(c, { type: 'invalidate', groupId: ch.groupId, entity: 'challenges' });
    return { ok: true };
  });

  r.post(`${base}/challenges/:challengeId/next-round`, { ...mod, perm: 'items.read', summary: 'Start the next round now (rotated), even if parts are open' }, async (c) => {
    const res = await db.transaction(async (tx) => {
      const ch = await load(c, tx);
      if (ch.kind !== 'split') throw badRequest('not_a_split_challenge');
      if (!canManage(c, ch)) throw forbidden();
      await startRound(tx, deps, ch, ch.round + 1);
      return { round: ch.round + 1 };
    });
    emit(c, { type: 'invalidate', groupId: c.get('group').id, entity: 'challenges' });
    return res;
  });

  r.post(`${base}/challenges/:challengeId/join`, { ...mod, perm: 'items.read', summary: 'Join a split challenge (parts from the next round)' }, async (c) => {
    const ch = await load(c);
    const me = c.get('user').id;
    if (ch.kind !== 'split') throw badRequest('not_a_split_challenge');
    if (ch.memberIds.includes(me)) return { ok: true };
    await db.update(challenges).set({ memberIds: [...ch.memberIds, me] }).where(eq(challenges.id, ch.id));
    emit(c, { type: 'invalidate', groupId: ch.groupId, entity: 'challenges' });
    return { ok: true };
  });

  r.post(`${base}/challenges/:challengeId/log`, { ...mod, perm: 'items.read', summary: 'Log my number for a day (daily target)', body: schemas.challengeLog }, async (c, { body }) => {
    const group = c.get('group');
    const ch = await load(c);
    if (ch.kind !== 'tally') throw badRequest('not_a_tally_challenge');
    const today = localDayKey(deps.clock().getTime(), group.timezone);
    const day = body.day ?? today;
    if (day > today) throw badRequest('future_day');
    const userId = c.get('user').id;
    await db
      .insert(challengeLogs)
      .values({ challengeId: ch.id, groupId: group.id, userId, day, value: body.value })
      .onConflictDoUpdate({ target: [challengeLogs.challengeId, challengeLogs.userId, challengeLogs.day], set: { value: body.value } });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'challenges' });
    return { ok: true };
  });

  r.delete(`${base}/challenges/:challengeId`, { ...mod, perm: 'items.read', summary: 'Archive a challenge' }, async (c) => {
    const ch = await load(c);
    if (!canManage(c, ch)) throw forbidden();
    await db.update(challenges).set({ status: 'archived' }).where(eq(challenges.id, ch.id));
    emit(c, { type: 'invalidate', groupId: ch.groupId, entity: 'challenges' });
    return { ok: true };
  });
}
