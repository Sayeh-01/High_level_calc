import { schemas } from '@circle/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { groupMembers, pollOptions, pollVotes, polls } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';

export async function pollResults(db: DbOrTx, groupId: string, pollIds: string[], userId: string) {
  if (pollIds.length === 0) return [];
  const [ps, opts, votes] = await Promise.all([
    db.select().from(polls).where(and(eq(polls.groupId, groupId), inArray(polls.id, pollIds))),
    db.select().from(pollOptions).where(and(eq(pollOptions.groupId, groupId), inArray(pollOptions.pollId, pollIds))).orderBy(asc(pollOptions.position)),
    db.select().from(pollVotes).where(and(eq(pollVotes.groupId, groupId), inArray(pollVotes.pollId, pollIds))),
  ]);
  return ps.map((p) => {
    const pv = votes.filter((v) => v.pollId === p.id);
    return {
      ...p,
      voterCount: new Set(pv.map((v) => v.userId)).size,
      myVotes: pv.filter((v) => v.userId === userId).map((v) => v.optionId),
      options: opts
        .filter((o) => o.pollId === p.id)
        .map((o) => ({
          id: o.id,
          label: o.label,
          votes: pv.filter((v) => v.optionId === o.id).length,
          voters: p.anonymous ? [] : pv.filter((v) => v.optionId === o.id).map((v) => v.userId),
        })),
    };
  });
}

export function registerPollRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId/polls';
  const mod = { module: 'polls', tags: ['polls'] };

  r.get(base, { ...mod, perm: 'items.read', summary: 'Polls with results' }, async (c) => {
    const groupId = c.get('group').id;
    const ids = (await db.select({ id: polls.id }).from(polls).where(eq(polls.groupId, groupId)).orderBy(desc(polls.createdAt)).limit(100)).map((p) => p.id);
    const res = await pollResults(db, groupId, ids, c.get('user').id);
    return ids.map((id) => res.find((p) => p.id === id)!);
  });

  r.post(base, { ...mod, perm: 'items.create', summary: 'Create a poll', body: schemas.pollCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(polls).values({ id, groupId: group.id, question: body.question, multi: body.multi, anonymous: body.anonymous, closesAt: body.closesAt ? new Date(body.closesAt) : null, createdBy: user.id });
      await tx.insert(pollOptions).values(body.options.map((label, i) => ({ id: newId(), pollId: id, groupId: group.id, label, position: i })));
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'created', entity: 'poll', entityId: id, summary: body.question });
      const members = (await tx.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).map((m) => m.u);
      await notify(tx, { userIds: members, exclude: user.id, groupId: group.id, kind: 'poll', title: body.question, body: 'New poll', data: { pollId: id }, push: false, now: deps.clock() });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'polls' });
    return (await pollResults(db, group.id, [id], user.id))[0];
  });

  r.get(`${base}/:pollId`, { ...mod, perm: 'items.read', summary: 'One poll with results' }, async (c) => {
    const [p] = await pollResults(db, c.get('group').id, [c.req.param('pollId')!], c.get('user').id);
    if (!p) throw notFound();
    return p;
  });

  r.post(`${base}/:pollId/vote`, { ...mod, perm: 'items.read', summary: 'Vote (replaces your previous vote)', body: schemas.pollVote }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const pollId = c.req.param('pollId')!;
    await db.transaction(async (tx) => {
      const [p] = await tx.select().from(polls).where(and(eq(polls.id, pollId), eq(polls.groupId, group.id)));
      if (!p) throw notFound();
      if (p.closesAt && p.closesAt.getTime() <= deps.clock().getTime()) throw conflict('poll_closed');
      const optionIds = [...new Set(body.optionIds)];
      if (!p.multi && optionIds.length !== 1) throw badRequest('single_choice');
      const valid = await tx.select({ id: pollOptions.id }).from(pollOptions).where(and(eq(pollOptions.pollId, p.id), inArray(pollOptions.id, optionIds)));
      if (valid.length !== optionIds.length) throw badRequest('bad_option');
      await tx.delete(pollVotes).where(and(eq(pollVotes.pollId, p.id), eq(pollVotes.userId, user.id)));
      await tx.insert(pollVotes).values(optionIds.map((optionId) => ({ pollId: p.id, optionId, groupId: group.id, userId: user.id })));
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'voted', entity: 'poll', entityId: p.id, summary: p.question });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'polls', id: pollId });
    return (await pollResults(db, group.id, [pollId], user.id))[0];
  });

  r.post(`${base}/:pollId/close`, { ...mod, perm: 'items.create', summary: 'Close a poll now' }, async (c) => {
    const group = c.get('group');
    const [p] = await db.select().from(polls).where(and(eq(polls.id, c.req.param('pollId')!), eq(polls.groupId, group.id)));
    if (!p) throw notFound();
    if (p.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    await db.update(polls).set({ closesAt: deps.clock() }).where(eq(polls.id, p.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'polls', id: p.id });
    return { ok: true };
  });
}
