import { schemas } from '@circle/shared';
import { and, asc, count, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { eventRsvps, events, groupMembers } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';
import { ensureMaterialized, materializeSeries, promoteFromWaitlist, scheduleReminder, setRsvp } from '../services/events';

export async function getEvent(db: DbOrTx, groupId: string, eventId: string) {
  const [row] = await db.select().from(events).where(and(eq(events.id, eventId), eq(events.groupId, groupId)));
  if (!row) throw notFound();
  return row;
}

/** Occurrences (never masters) with RSVP counts and the caller's status. */
export async function listOccurrences(db: DbOrTx, groupIds: string[], userId: string, from: Date, to: Date) {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({
      event: events,
      going: sql<number>`(select count(*) from ${eventRsvps} r where r.event_id = ${events.id} and r.status = 'going')`.mapWith(Number),
      waitlisted: sql<number>`(select count(*) from ${eventRsvps} r where r.event_id = ${events.id} and r.status = 'waitlist')`.mapWith(Number),
      myStatus: sql<string | null>`(select r.status from ${eventRsvps} r where r.event_id = ${events.id} and r.user_id = ${userId})`,
    })
    .from(events)
    .where(and(inArray(events.groupId, groupIds), isNull(events.rrule), isNull(events.cancelledAt), gte(events.startsAt, from), lt(events.startsAt, to)))
    .orderBy(asc(events.startsAt))
    .limit(500);
  return rows.map((r) => ({ ...r.event, going: r.going, waitlisted: r.waitlisted, myStatus: r.myStatus }));
}

export function registerEventRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId/events';
  const mod = { module: 'events', tags: ['events'] };

  r.get(base, { ...mod, perm: 'items.read', summary: 'Events in a date range', query: z.object({ from: z.string().optional(), to: z.string().optional() }) }, async (c, { query }) => {
    const group = c.get('group');
    const now = deps.clock();
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date(now.getTime() + 60 * 86_400_000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest('bad_range');
    await ensureMaterialized(db, [group.id], now);
    return listOccurrences(db, [group.id], c.get('user').id, from, to);
  });

  r.post(base, { ...mod, perm: 'items.create', summary: 'Create an event (optionally recurring)', body: schemas.eventCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const defaults = group.settings as { eventCapacity?: number; waitlist?: boolean };
    const ev = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(events)
        .values({
          id: newId(),
          groupId: group.id,
          title: body.title,
          notes: body.notes ?? null,
          startsAt: new Date(body.startsAt),
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          rrule: body.rrule ?? null,
          tz: group.timezone,
          location: body.location ?? null,
          capacity: body.capacity === undefined ? defaults.eventCapacity ?? null : body.capacity,
          waitlist: body.waitlist ?? defaults.waitlist ?? false,
          reminderMin: body.reminderMin === undefined ? 60 : body.reminderMin,
          createdBy: user.id,
        })
        .returning();
      if (row.rrule) await materializeSeries(tx, row, deps.clock());
      else await scheduleReminder(tx, row);
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'created', entity: 'event', entityId: row.id, summary: row.title });
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events' });
    // a recurring series answers with its first occurrence so the app can open it
    if (ev.rrule) {
      const [first] = await db.select().from(events).where(eq(events.seriesId, ev.id)).orderBy(asc(events.startsAt)).limit(1);
      return { ...(first ?? ev), series: ev };
    }
    return ev;
  });

  r.get(`${base}/:eventId`, { ...mod, perm: 'items.read', summary: 'Event with RSVPs and waitlist' }, async (c) => {
    const groupId = c.get('group').id;
    const ev = await getEvent(db, groupId, c.req.param('eventId')!);
    const rsvps = await db
      .select({ userId: eventRsvps.userId, status: eventRsvps.status, waitlistPos: eventRsvps.waitlistPos, displayName: groupMembers.displayName, guestName: eventRsvps.guestName })
      .from(eventRsvps)
      .leftJoin(groupMembers, and(eq(groupMembers.groupId, eventRsvps.groupId), eq(groupMembers.userId, eventRsvps.userId)))
      .where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.groupId, groupId)))
      .orderBy(asc(eventRsvps.waitlistPos), asc(eventRsvps.updatedAt));
    const [{ members }] = await db.select({ members: count() }).from(groupMembers).where(eq(groupMembers.groupId, groupId));
    const named = rsvps.map((x) => ({ ...x, displayName: x.displayName ?? (x.guestName ? `${x.guestName} (guest)` : null), guest: x.userId.startsWith('guest:') }));
    return { event: ev, rsvps: named, memberCount: members, myStatus: rsvps.find((x) => x.userId === c.get('user').id)?.status ?? null };
  });

  r.patch(`${base}/:eventId`, { ...mod, perm: 'items.create', summary: 'Edit an event', body: schemas.eventUpdate }, async (c, { body }) => {
    const group = c.get('group');
    const ev = await getEvent(db, group.id, c.req.param('eventId')!);
    if (ev.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    const { rrule: _ignored, ...rest } = body;
    const patch = {
      ...rest,
      startsAt: rest.startsAt ? new Date(rest.startsAt) : undefined,
      endsAt: rest.endsAt === undefined ? undefined : rest.endsAt ? new Date(rest.endsAt) : null,
    };
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(events).set(patch).where(and(eq(events.id, ev.id), eq(events.groupId, group.id))).returning();
      if (row.capacity !== null && (ev.capacity === null || row.capacity > ev.capacity)) {
        while (await promoteFromWaitlist(deps, tx, row)) {}
      }
      await scheduleReminder(tx, row);
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'updated', entity: 'event', entityId: row.id, summary: row.title });
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events', id: ev.id });
    return updated;
  });

  r.delete(`${base}/:eventId`, { ...mod, perm: 'items.create', summary: 'Cancel an event (and the rest of its series)' }, async (c) => {
    const group = c.get('group');
    const ev = await getEvent(db, group.id, c.req.param('eventId')!);
    if (ev.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    const now = deps.clock();
    await db.transaction(async (tx) => {
      await tx.update(events).set({ cancelledAt: now }).where(and(eq(events.id, ev.id), eq(events.groupId, group.id)));
      const seriesId = ev.seriesId ?? (ev.rrule ? ev.id : null);
      const all = c.req.query('series') === '1' || !!ev.rrule;
      if (seriesId && all) {
        await tx
          .update(events)
          .set({ cancelledAt: now })
          .where(and(eq(events.groupId, group.id), or(eq(events.id, seriesId), and(eq(events.seriesId, seriesId), gte(events.startsAt, ev.startsAt)))));
      }
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'cancelled', entity: 'event', entityId: ev.id, summary: ev.title });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events' });
    return { ok: true };
  });

  r.post(`${base}/:eventId/rsvp`, { ...mod, perm: 'items.read', summary: 'RSVP going / maybe / no', body: schemas.rsvp }, async (c, { body }) => {
    const group = c.get('group');
    const eventId = c.req.param('eventId')!;
    const result = await db.transaction((tx) => setRsvp(deps, tx, { groupId: group.id, eventId, userId: c.get('user').id, status: body.status }));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events', id: eventId });
    return result;
  });

  r.post(`${base}/:eventId/nudge`, { ...mod, perm: 'items.create', summary: '"Need N more": notify members who have not answered' }, async (c) => {
    const group = c.get('group');
    const ev = await getEvent(db, group.id, c.req.param('eventId')!);
    const answered = (await db.select({ u: eventRsvps.userId }).from(eventRsvps).where(eq(eventRsvps.eventId, ev.id))).map((r) => r.u);
    const all = (await db.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).map((r) => r.u);
    const pending = all.filter((u) => !answered.includes(u));
    const going = (await db.select({ n: count() }).from(eventRsvps).where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.status, 'going'))))[0].n;
    const need = ev.capacity ? Math.max(0, ev.capacity - going) : null;
    await notify(db, { userIds: pending, exclude: c.get('user').id, groupId: group.id, kind: 'event_nudge', title: ev.title, body: need ? `Need ${need} more. Are you in?` : 'Are you in?', data: { eventId: ev.id, category: 'rsvp' }, now: deps.clock() });
    return { notified: pending.filter((u) => u !== c.get('user').id).length, need };
  });
}
