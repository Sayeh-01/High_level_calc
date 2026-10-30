import { nextInRotation, nextOccurrence, schemas } from '@circle/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { comments, files, groupMembers, taskCompletions, tasks } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, logActivity, notify } from '../effects';
import { badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { registerJob } from '../jobs';
import { assertMembers } from './groups';

export type TaskRow = typeof tasks.$inferSelect;

export async function getTask(db: DbOrTx, groupId: string, taskId: string): Promise<TaskRow> {
  // B7 #1: every item lookup filters on the item id AND the group from the middleware
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.groupId, groupId)));
  if (!row) throw notFound();
  return row;
}

export async function scheduleTaskDue(tx: DbOrTx, t: TaskRow) {
  if (!t.dueAt || !t.assigneeId || t.status !== 'open') return;
  await enqueueJob(tx, { kind: 'task_due', payload: { taskId: t.id, dueAt: t.dueAt.toISOString() }, runAt: t.dueAt, dedupeKey: `task_due:${t.id}:${t.dueAt.toISOString()}` });
}

function assertCanEdit(c: Ctx, t: TaskRow) {
  if (t.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
}

/** Hooks so later versions (points, streaks) can react to completions in the same transaction. */
export const onTaskCompleted: ((tx: DbOrTx, deps: Deps, a: { task: TaskRow; userId: string; completionId: string }) => Promise<void>)[] = [];

export function registerTaskRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId/tasks';
  const mod = { module: 'tasks', tags: ['tasks'] };

  r.get(base, { ...mod, perm: 'items.read', summary: 'List tasks', query: z.object({ status: z.enum(['open', 'done', 'all']).default('open'), mine: z.string().optional() }) }, async (c, { query }) => {
    const groupId = c.get('group').id;
    const conds = [eq(tasks.groupId, groupId)];
    if (query.status !== 'all') conds.push(eq(tasks.status, query.status));
    if (query.mine) conds.push(eq(tasks.assigneeId, c.get('user').id));
    return db.select().from(tasks).where(and(...conds)).orderBy(asc(tasks.dueAt), desc(tasks.createdAt)).limit(300);
  });

  r.post(base, { ...mod, perm: 'items.create', summary: 'Create a task', body: schemas.taskCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const rotation = body.rotation?.length ? body.rotation : null;
    await assertMembers(db, group.id, [body.assigneeId, ...(rotation ?? [])]);
    const assigneeId = body.assigneeId ?? (rotation ? rotation[0] : null);
    const task = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tasks)
        .values({
          id: newId(),
          groupId: group.id,
          title: body.title,
          notes: body.notes ?? null,
          assigneeId,
          rotation,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          rrule: body.rrule ?? null,
          points: body.points ?? 0,
          createdBy: user.id,
        })
        .returning();
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'created', entity: 'task', entityId: t.id, summary: t.title });
      if (assigneeId && assigneeId !== user.id) {
        await notify(tx, { userIds: [assigneeId], groupId: group.id, kind: 'task_assigned', title: t.title, body: `${c.get('member').displayName} assigned you`, data: { taskId: t.id, category: 'task' }, now: deps.clock() });
      }
      await scheduleTaskDue(tx, t);
      return t;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks', id: task.id });
    return task;
  });

  r.get(`${base}/:taskId`, { ...mod, perm: 'items.read', summary: 'Task with comments and history' }, async (c) => {
    const groupId = c.get('group').id;
    const task = await getTask(db, groupId, c.req.param('taskId')!);
    const [thread, history] = await Promise.all([
      db.select().from(comments).where(and(eq(comments.groupId, groupId), eq(comments.entity, 'task'), eq(comments.entityId, task.id))).orderBy(asc(comments.createdAt)),
      db.select().from(taskCompletions).where(and(eq(taskCompletions.groupId, groupId), eq(taskCompletions.taskId, task.id))).orderBy(desc(taskCompletions.completedAt)).limit(50),
    ]);
    return { task, comments: thread, completions: history };
  });

  r.patch(`${base}/:taskId`, { ...mod, perm: 'items.create', summary: 'Edit a task', body: schemas.taskUpdate }, async (c, { body }) => {
    const group = c.get('group');
    const task = await getTask(db, group.id, c.req.param('taskId')!);
    assertCanEdit(c, task);
    await assertMembers(db, group.id, [body.assigneeId, ...(body.rotation ?? [])]);
    const updated = await db.transaction(async (tx) => {
      const [t] = await tx
        .update(tasks)
        .set({
          ...(body.title !== undefined && { title: body.title }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
          ...(body.rotation !== undefined && { rotation: body.rotation?.length ? body.rotation : null }),
          ...(body.dueAt !== undefined && { dueAt: body.dueAt ? new Date(body.dueAt) : null }),
          ...(body.rrule !== undefined && { rrule: body.rrule }),
          ...(body.points !== undefined && { points: body.points }),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.groupId, group.id)))
        .returning();
      if (body.assigneeId && body.assigneeId !== task.assigneeId && body.assigneeId !== c.get('user').id) {
        await notify(tx, { userIds: [body.assigneeId], groupId: group.id, kind: 'task_assigned', title: t.title, body: `${c.get('member').displayName} assigned you`, data: { taskId: t.id }, now: deps.clock() });
      }
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'updated', entity: 'task', entityId: t.id, summary: t.title });
      await scheduleTaskDue(tx, t);
      return t;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks', id: task.id });
    return updated;
  });

  r.delete(`${base}/:taskId`, { ...mod, perm: 'items.create', summary: 'Delete a task' }, async (c) => {
    const group = c.get('group');
    const task = await getTask(db, group.id, c.req.param('taskId')!);
    assertCanEdit(c, task);
    await db.transaction(async (tx) => {
      await tx.delete(tasks).where(and(eq(tasks.id, task.id), eq(tasks.groupId, group.id)));
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'deleted', entity: 'task', entityId: task.id, summary: task.title });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks' });
    return { ok: true };
  });

  r.post(`${base}/:taskId/complete`, { ...mod, perm: 'items.read', summary: 'Complete a task (optional photo proof)', body: schemas.taskComplete }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const result = await db.transaction(async (tx) => {
      const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, c.req.param('taskId')!), eq(tasks.groupId, group.id))).for('update');
      if (!task) throw notFound();
      if (task.status === 'done') throw badRequest('already_done');
      if (body.photoFileId) {
        const [f] = await tx.select().from(files).where(and(eq(files.id, body.photoFileId), eq(files.groupId, group.id)));
        if (!f) throw badRequest('bad_file');
      }
      const completionId = newId();
      await tx.insert(taskCompletions).values({ id: completionId, taskId: task.id, groupId: group.id, userId: user.id, photoFileId: body.photoFileId ?? null, points: task.points, dueAt: task.dueAt, completedAt: deps.clock() });
      let next: Partial<TaskRow>;
      const nextDue = task.rrule && task.dueAt ? nextOccurrence(task.rrule, task.dueAt.getTime(), group.timezone, Math.max(task.dueAt.getTime(), deps.clock().getTime())) : null;
      if (nextDue) {
        let assigneeId = task.assigneeId;
        if (task.rotation?.length) {
          const away = (await tx.select({ userId: groupMembers.userId }).from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.away, true)))).map((m) => m.userId);
          assigneeId = nextInRotation(task.rotation, task.assigneeId, away) ?? task.assigneeId;
        }
        next = { dueAt: new Date(nextDue), assigneeId, status: 'open', completedAt: deps.clock(), completedBy: user.id };
      } else {
        next = { status: 'done', completedAt: deps.clock(), completedBy: user.id };
      }
      const [updated] = await tx.update(tasks).set(next).where(eq(tasks.id, task.id)).returning();
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'completed', entity: 'task', entityId: task.id, summary: task.title });
      for (const hook of onTaskCompleted) await hook(tx, deps, { task, userId: user.id, completionId });
      if (updated.status === 'open' && updated.assigneeId && updated.assigneeId !== task.assigneeId) {
        await notify(tx, { userIds: [updated.assigneeId], groupId: group.id, kind: 'task_assigned', title: updated.title, body: 'Your turn is next', data: { taskId: updated.id }, now: deps.clock() });
      }
      await scheduleTaskDue(tx, updated);
      return updated;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks', id: result.id });
    return result;
  });

  r.post(`${base}/:taskId/reopen`, { ...mod, perm: 'items.create', summary: 'Reopen a completed task' }, async (c) => {
    const group = c.get('group');
    const task = await getTask(db, group.id, c.req.param('taskId')!);
    const [t] = await db.update(tasks).set({ status: 'open', completedAt: null, completedBy: null }).where(and(eq(tasks.id, task.id), eq(tasks.groupId, group.id))).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks', id: t.id });
    return t;
  });

  r.post(`${base}/:taskId/comments`, { ...mod, perm: 'items.read', summary: 'Comment on a task', body: schemas.commentCreate }, async (c, { body }) => {
    const group = c.get('group');
    const task = await getTask(db, group.id, c.req.param('taskId')!);
    const user = c.get('user');
    const row = await db.transaction(async (tx) => {
      const [cm] = await tx.insert(comments).values({ id: newId(), groupId: group.id, entity: 'task', entityId: task.id, userId: user.id, body: body.body }).returning();
      const watchers = [task.createdBy, task.assigneeId].filter((x): x is string => !!x);
      await notify(tx, { userIds: watchers, exclude: user.id, groupId: group.id, kind: 'comment', title: task.title, body: body.body.slice(0, 120), data: { taskId: task.id }, now: deps.clock() });
      return cm;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks', id: task.id });
    return row;
  });
}

registerJob('task_due', async (deps, payload) => {
  const [task] = await deps.db.select().from(tasks).where(eq(tasks.id, payload.taskId));
  if (!task || task.status !== 'open' || !task.assigneeId || task.dueAt?.toISOString() !== payload.dueAt) return;
  await notify(deps.db, { userIds: [task.assigneeId], groupId: task.groupId, kind: 'task_due', title: task.title, body: 'Due now', data: { taskId: task.id, category: 'task' }, now: deps.clock() });
});

export async function taskTitles(db: DbOrTx, ids: string[]) {
  return ids.length ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, ids)) : [];
}
