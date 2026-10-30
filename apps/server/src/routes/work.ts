import { defaultWorkDays, fromZoned, isWorkDay, leaveOverlaps, localDayKey, parseActionItems, schemas } from '@circle/shared';
import { and, asc, desc, eq, gte, lte, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { groupMembers, groups, leaves, meetings, messages, standups, tasks } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { registerJob } from '../jobs';

// Work Team pack (v3.0, A6): task board, async stand-ups with a summary posted to chat, meeting notes → tasks, leave calendar.

export const SYSTEM_USER = 'system';
const REMIND = { hour: 9, minute: 30 };
const SUMMARY = { hour: 12, minute: 0 };

type Group = typeof groups.$inferSelect;
/** 'YYYY-MM-DD' + n calendar days */
const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const workDaysOf = (g: Group) => ((g.settings as { workDays?: number[] }).workDays ?? defaultWorkDays(g.timezone));

/** Next work-day stand-up jobs (reminder + summary) that are still in the future. Dedupe keys make this idempotent. */
async function ensureStandupJobs(db: DbOrTx, g: Group, now: Date) {
  let day = localDayKey(now.getTime(), g.timezone);
  for (let i = 0; i < 14; i++, day = addDays(day, 1)) {
    if (!isWorkDay(day, workDaysOf(g))) continue;
    const [y, m, d] = day.split('-').map(Number);
    let any = false;
    for (const [kind, t] of [['remind', REMIND], ['summary', SUMMARY]] as const) {
      const at = fromZoned({ year: y, month: m, day: d, ...t }, g.timezone);
      if (at <= now.getTime()) continue;
      any = true;
      await enqueueJob(db, { kind: 'standup', payload: { groupId: g.id, day, kind }, runAt: new Date(at), dedupeKey: `standup:${g.id}:${day}:${kind}` });
    }
    if (any) return;
  }
}

async function adults(db: DbOrTx, groupId: string) {
  return (await db.select({ u: groupMembers.userId, role: groupMembers.role, name: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).filter((m) => ['owner', 'admin', 'manager', 'member'].includes(m.role));
}

async function onLeave(db: DbOrTx, groupId: string, day: string) {
  return (await db.select({ u: leaves.userId }).from(leaves).where(and(eq(leaves.groupId, groupId), eq(leaves.status, 'approved'), lte(leaves.startDay, day), gte(leaves.endDay, day)))).map((l) => l.u);
}

registerJob('standup', async (deps, p) => {
  const [g] = await deps.db.select().from(groups).where(eq(groups.id, p.groupId));
  if (!g || !g.modules.includes('standups')) return;
  const people = await adults(deps.db, g.id);
  const away = await onLeave(deps.db, g.id, p.day);
  const answers = await deps.db.select().from(standups).where(and(eq(standups.groupId, g.id), eq(standups.day, p.day)));
  const missing = people.filter((m) => !away.includes(m.u) && !answers.find((a) => a.userId === m.u));
  if (p.kind === 'remind') {
    await notify(deps.db, { userIds: missing.map((m) => m.u), groupId: g.id, kind: 'standup', title: `☀️ ${g.name}`, body: 'Stand-up: what did you do, what’s next, anything blocking?', data: { href: `/g/${g.id}/standups` }, now: deps.clock() });
  } else {
    const name = (u: string) => people.find((m) => m.u === u)?.name ?? '—';
    const lines = answers.map((a) => `• ${name(a.userId)}: ${a.today}${a.blockers ? ` — ⛔ ${a.blockers}` : ''}`);
    const body = [`☀️ Stand-up ${p.day}`, ...lines, missing.length ? `Not in yet: ${missing.map((m) => m.name).join(', ')}` : '', away.length ? `🌴 Off: ${away.map(name).join(', ')}` : ''].filter(Boolean).join('\n');
    await deps.db.insert(messages).values({ id: newId(), groupId: g.id, userId: SYSTEM_USER, body, createdAt: deps.clock() });
    deps.bus.publish({ type: 'invalidate', groupId: g.id, entity: 'messages' });
  }
  // keep the cycle going
  await ensureStandupJobs(deps.db, g, new Date(Math.max(deps.clock().getTime(), Date.parse(`${p.day}T23:59:00Z`))));
});

export function registerWorkRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';

  // ── board (a view of tasks: To do / Doing / Done) ───────────────────────────
  r.get(`${base}/board`, { module: 'tasks', perm: 'items.read', tags: ['tasks'], summary: 'Task board: to do, doing, done in the last 14 days' }, async (c) => {
    const group = c.get('group');
    const since = new Date(deps.clock().getTime() - 14 * 86_400_000);
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.groupId, group.id), or(eq(tasks.status, 'open'), and(eq(tasks.status, 'done'), gte(tasks.completedAt, since)))))
      .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
      .limit(500);
    const open = rows.filter((t) => t.status === 'open' && !t.rrule);
    return { todo: open.filter((t) => t.stage !== 'doing'), doing: open.filter((t) => t.stage === 'doing'), done: rows.filter((t) => t.status === 'done') };
  });

  r.post(`${base}/tasks/:taskId/stage`, { module: 'tasks', perm: 'items.read', tags: ['tasks'], summary: 'Move a task between To do and Doing', body: schemas.taskStage }, async (c, { body }) => {
    const group = c.get('group');
    const [t] = await db.select().from(tasks).where(and(eq(tasks.id, c.req.param('taskId')!), eq(tasks.groupId, group.id)));
    if (!t) throw notFound();
    if (t.assigneeId !== c.get('user').id && t.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    if (t.status !== 'open') throw conflict('task_done');
    await db.update(tasks).set({ stage: body.stage }).where(eq(tasks.id, t.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks', id: t.id });
    return { ok: true };
  });

  // ── stand-ups ───────────────────────────────────────────────────────────────
  const su = { module: 'standups', tags: ['standups'] };
  r.get(`${base}/standups`, { ...su, perm: 'items.read', summary: 'A day’s stand-up answers, who’s missing and who’s off', query: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }, async (c, { query }) => {
    const group = c.get('group');
    await ensureStandupJobs(db, group, deps.clock());
    const day = query.day ?? localDayKey(deps.clock().getTime(), group.timezone);
    const people = await adults(db, group.id);
    const away = await onLeave(db, group.id, day);
    const answers = await db.select().from(standups).where(and(eq(standups.groupId, group.id), eq(standups.day, day)));
    return { day, workDay: isWorkDay(day, workDaysOf(group)), answers, missing: people.filter((m) => !away.includes(m.u) && !answers.find((a) => a.userId === m.u)).map((m) => m.u), away };
  });

  r.put(`${base}/standups/me`, { ...su, perm: 'items.read', summary: 'My answers for today', body: schemas.standupAnswer }, async (c, { body }) => {
    const group = c.get('group');
    const day = localDayKey(deps.clock().getTime(), group.timezone);
    const values = { ...body, answeredAt: deps.clock() };
    await db.insert(standups).values({ groupId: group.id, userId: c.get('user').id, day, ...values }).onConflictDoUpdate({ target: [standups.groupId, standups.userId, standups.day], set: values });
    await ensureStandupJobs(db, group, deps.clock());
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'standups' });
    return { ok: true, day };
  });

  // ── meeting notes → tasks ───────────────────────────────────────────────────
  const mt = { module: 'meetings', tags: ['meetings'] };
  async function members(groupId: string) {
    return (await db.select({ userId: groupMembers.userId, displayName: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, groupId)));
  }
  async function loadMeeting(c: Ctx) {
    const [m] = await db.select().from(meetings).where(and(eq(meetings.id, c.req.param('meetingId')!), eq(meetings.groupId, c.get('group').id)));
    if (!m) throw notFound();
    return m;
  }

  r.get(`${base}/meetings`, { ...mt, perm: 'items.read', summary: 'Meeting notes' }, async (c) => {
    return db.select().from(meetings).where(eq(meetings.groupId, c.get('group').id)).orderBy(desc(meetings.day), desc(meetings.createdAt)).limit(200);
  });

  r.post(`${base}/meetings`, { ...mt, perm: 'items.create', summary: 'Write meeting notes ("- [ ] … @name" lines become action items)', body: schemas.meetingCreate }, async (c, { body }) => {
    const group = c.get('group');
    const items = parseActionItems(body.notes, await members(group.id)).map((i) => ({ ...i, taskId: null }));
    const [row] = await db.insert(meetings).values({ id: newId(), groupId: group.id, title: body.title, day: body.day, notes: body.notes, actionItems: items, createdBy: c.get('user').id, createdAt: deps.clock() }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meetings' });
    return row;
  });

  r.patch(`${base}/meetings/:meetingId`, { ...mt, perm: 'items.create', summary: 'Edit notes (action items re-read; ones already turned into tasks are kept)', body: schemas.meetingUpdate }, async (c, { body }) => {
    const m = await loadMeeting(c);
    const notes = body.notes ?? m.notes;
    const parsed = parseActionItems(notes, await members(m.groupId));
    const kept = m.actionItems.filter((i) => i.taskId);
    const items = [...kept, ...parsed.filter((p) => !kept.find((k) => k.title === p.title)).map((p) => ({ ...p, taskId: null }))];
    const [row] = await db.update(meetings).set({ title: body.title ?? m.title, notes, actionItems: items }).where(eq(meetings.id, m.id)).returning();
    emit(c, { type: 'invalidate', groupId: m.groupId, entity: 'meetings' });
    return row;
  });

  r.post(`${base}/meetings/:meetingId/tasks`, { ...mt, perm: 'items.create', summary: 'Turn the action items into tasks' }, async (c) => {
    const group = c.get('group');
    if (!group.modules.includes('tasks')) throw badRequest('tasks_module_off');
    const m = await loadMeeting(c);
    const ids = new Set((await members(group.id)).map((x) => x.userId));
    const created = await db.transaction(async (tx) => {
      const items = [...m.actionItems];
      let n = 0;
      for (const item of items) {
        if (item.taskId) continue;
        const [y, mo, d] = (item.dueDay ?? '').split('-').map(Number);
        const dueAt = item.dueDay ? new Date(fromZoned({ year: y, month: mo, day: d, hour: 17, minute: 0 }, group.timezone)) : null;
        const [t] = await tx
          .insert(tasks)
          .values({ id: newId(), groupId: group.id, title: item.title, assigneeId: item.assigneeId && ids.has(item.assigneeId) ? item.assigneeId : null, dueAt, createdBy: c.get('user').id, notes: `From meeting: ${m.title} (${m.day})` })
          .returning();
        item.taskId = t.id;
        n++;
        if (t.assigneeId && t.assigneeId !== c.get('user').id) await notify(tx, { userIds: [t.assigneeId], groupId: group.id, kind: 'task_assigned', title: t.title, body: `From ${m.title}`, data: { taskId: t.id }, now: deps.clock() });
      }
      await tx.update(meetings).set({ actionItems: items }).where(eq(meetings.id, m.id));
      if (n) await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'task', summary: `${n} tasks from ${m.title}` });
      return n;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks' });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meetings' });
    return { created };
  });

  // ── leave calendar ──────────────────────────────────────────────────────────
  const lv = { module: 'leave', tags: ['leave'] };
  r.get(`${base}/time-off`, { ...lv, perm: 'items.read', summary: 'Leave in a date range (pending ones only for the requester and managers)', query: z.object({ from: z.string().optional(), to: z.string().optional() }) }, async (c, { query }) => {
    const group = c.get('group');
    const today = localDayKey(deps.clock().getTime(), group.timezone);
    const from = query.from ?? today;
    const to = query.to ?? addDays(today, 60);
    const rows = await db.select().from(leaves).where(and(eq(leaves.groupId, group.id), ne(leaves.status, 'rejected'), lte(leaves.startDay, to), gte(leaves.endDay, from))).orderBy(asc(leaves.startDay));
    const me = c.get('user').id;
    const manager = actorCan(c, 'approve');
    return rows.filter((l) => l.status === 'approved' || l.userId === me || manager);
  });

  r.post(`${base}/time-off`, { ...lv, perm: 'items.read', summary: 'Book leave (needs a manager’s OK where the group asks for it)', body: schemas.leaveCreate }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user').id;
    if (body.endDay < body.startDay) throw badRequest('end_before_start');
    const mine = await db.select().from(leaves).where(and(eq(leaves.groupId, group.id), eq(leaves.userId, me), ne(leaves.status, 'rejected')));
    if (mine.some((l) => leaveOverlaps(l, body))) throw conflict('overlapping_leave');
    const needsApproval = (group.settings as { leaveApproval?: boolean }).leaveApproval === true;
    const row = await db.transaction(async (tx) => {
      const [l] = await tx.insert(leaves).values({ id: newId(), groupId: group.id, userId: me, startDay: body.startDay, endDay: body.endDay, kind: body.kind, note: body.note ?? null, status: needsApproval ? 'pending' : 'approved', createdAt: deps.clock() }).returning();
      if (needsApproval) {
        const managers = (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).filter((m) => ['owner', 'admin', 'manager'].includes(m.role) && m.u !== me);
        await notify(tx, { userIds: managers.map((m) => m.u), groupId: group.id, kind: 'leave_request', title: '🌴 Time-off request', body: `${c.get('member').displayName}: ${body.startDay} → ${body.endDay}`, data: { leaveId: l.id, href: `/g/${group.id}/leave` }, now: deps.clock() });
      }
      return l;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'leave' });
    return row;
  });

  for (const action of ['approve', 'reject'] as const) {
    r.post(`${base}/time-off/:leaveId/${action}`, { ...lv, perm: 'approve', summary: `${action === 'approve' ? 'Approve' : 'Turn down'} a time-off request` }, async (c) => {
      const group = c.get('group');
      const [l] = await db.select().from(leaves).where(and(eq(leaves.id, c.req.param('leaveId')!), eq(leaves.groupId, group.id)));
      if (!l) throw notFound();
      if (l.status !== 'pending') throw conflict('already_decided');
      if (l.userId === c.get('user').id) throw forbidden('own_request');
      await db.update(leaves).set({ status: action === 'approve' ? 'approved' : 'rejected', decidedBy: c.get('user').id }).where(eq(leaves.id, l.id));
      await notify(db, { userIds: [l.userId], groupId: group.id, kind: 'leave_decided', title: action === 'approve' ? '🌴 Time off approved' : 'Time off not approved', body: `${l.startDay} → ${l.endDay}`, data: { href: `/g/${group.id}/leave` }, now: deps.clock() });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'leave' });
      return { ok: true };
    });
  }

  r.delete(`${base}/time-off/:leaveId`, { ...lv, perm: 'items.read', summary: 'Cancel my leave' }, async (c) => {
    const group = c.get('group');
    const res = await db.delete(leaves).where(and(eq(leaves.id, c.req.param('leaveId')!), eq(leaves.groupId, group.id), eq(leaves.userId, c.get('user').id))).returning();
    if (!res.length) throw notFound();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'leave' });
    return { ok: true };
  });
}

