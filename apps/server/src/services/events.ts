import { expandRRule } from '@circle/shared';
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { eventRsvps, events, groupMembers } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, notify } from '../effects';
import { conflict, notFound } from '../errors';
import { newId } from '../ids';
import { registerJob } from '../jobs';

export type EventRow = typeof events.$inferSelect;
export const HORIZON_DAYS = 35;
const DAY = 86_400_000;

/** Occurrences of a recurring master are concrete rows so RSVPs, capacity and the waitlist work per date. */
export async function materializeSeries(tx: DbOrTx, master: EventRow, now: Date) {
  if (!master.rrule) return;
  const until = now.getTime() + HORIZON_DAYS * DAY;
  if (master.materializedUntil && master.materializedUntil.getTime() >= until - 7 * DAY) return;
  const from = Math.max(master.materializedUntil?.getTime() ?? 0, now.getTime() - DAY);
  const starts = expandRRule(master.rrule, master.startsAt.getTime(), master.tz, from, until, 60);
  const duration = master.endsAt ? master.endsAt.getTime() - master.startsAt.getTime() : null;
  if (starts.length) {
    const rows = starts.map((s) => ({
      id: newId(),
      groupId: master.groupId,
      seriesId: master.id,
      title: master.title,
      notes: master.notes,
      startsAt: new Date(s),
      endsAt: duration === null ? null : new Date(s + duration),
      tz: master.tz,
      location: master.location,
      capacity: master.capacity,
      waitlist: master.waitlist,
      reminderMin: master.reminderMin,
      createdBy: master.createdBy,
    }));
    const inserted = await tx.insert(events).values(rows).onConflictDoNothing().returning();
    for (const ev of inserted) await scheduleReminder(tx, ev);
  }
  await tx.update(events).set({ materializedUntil: new Date(until) }).where(eq(events.id, master.id));
}

export async function ensureMaterialized(db: DbOrTx, groupIds: string[], now: Date) {
  if (groupIds.length === 0) return;
  const soon = new Date(now.getTime() + (HORIZON_DAYS - 7) * DAY);
  const masters = await db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.groupId, groupIds),
        isNotNull(events.rrule),
        isNull(events.seriesId),
        isNull(events.cancelledAt),
        or(isNull(events.materializedUntil), lt(events.materializedUntil, soon)),
      ),
    );
  for (const m of masters) await materializeSeries(db, m, now);
}

export async function scheduleReminder(tx: DbOrTx, ev: EventRow) {
  if (ev.reminderMin === null || ev.rrule) return;
  await enqueueJob(tx, {
    kind: 'event_reminder',
    payload: { eventId: ev.id },
    runAt: new Date(ev.startsAt.getTime() - ev.reminderMin * 60_000),
    dedupeKey: `event_reminder:${ev.id}:${ev.startsAt.toISOString()}`,
  });
}

export async function goingCount(tx: DbOrTx, eventId: string) {
  const [{ n }] = await tx.select({ n: count() }).from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, 'going')));
  return n;
}

/**
 * RSVP in one transaction with the event row locked (SELECT … FOR UPDATE), so two people can't both take the last
 * spot and a freed spot always promotes the first person on the waitlist (B7 #8).
 */
export async function setRsvp(
  deps: Deps,
  tx: DbOrTx,
  a: { groupId: string; eventId: string; userId: string; status: 'going' | 'maybe' | 'no' },
): Promise<{ status: string; waitlistPos: number | null; promoted: string | null }> {
  const [ev] = await tx
    .select()
    .from(events)
    .where(and(eq(events.id, a.eventId), eq(events.groupId, a.groupId)))
    .for('update');
  if (!ev || ev.rrule) throw notFound();
  if (ev.cancelledAt) throw conflict('event_cancelled');
  const [prev] = await tx.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.userId, a.userId)));
  let status: string = a.status;
  let waitlistPos: number | null = null;
  if (a.status === 'going' && prev?.status !== 'going') {
    if (ev.capacity !== null && (await goingCount(tx, ev.id)) >= ev.capacity) {
      if (!ev.waitlist) throw conflict('event_full', 'This event is full');
      if (prev?.status === 'waitlist') return { status: 'waitlist', waitlistPos: prev.waitlistPos, promoted: null };
      const [{ m }] = await tx.select({ m: max(eventRsvps.waitlistPos) }).from(eventRsvps).where(eq(eventRsvps.eventId, ev.id));
      status = 'waitlist';
      waitlistPos = (m ?? 0) + 1;
    }
  } else if (a.status === 'going' && prev?.status === 'going') {
    return { status: 'going', waitlistPos: null, promoted: null };
  }
  await tx
    .insert(eventRsvps)
    .values({ eventId: ev.id, groupId: a.groupId, userId: a.userId, status, waitlistPos, updatedAt: deps.clock() })
    .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { status, waitlistPos, updatedAt: deps.clock() } });

  let promoted: string | null = null;
  if (prev?.status === 'going' && status !== 'going' && ev.capacity !== null) {
    promoted = await promoteFromWaitlist(deps, tx, ev);
  }
  return { status, waitlistPos, promoted };
}

export async function promoteFromWaitlist(deps: Deps, tx: DbOrTx, ev: EventRow): Promise<string | null> {
  if (ev.capacity !== null && (await goingCount(tx, ev.id)) >= ev.capacity) return null;
  const [next] = await tx
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.status, 'waitlist')))
    .orderBy(asc(eventRsvps.waitlistPos))
    .limit(1);
  if (!next) return null;
  await tx
    .update(eventRsvps)
    .set({ status: 'going', waitlistPos: null, updatedAt: deps.clock() })
    .where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.userId, next.userId)));
  await notify(tx, {
    userIds: [next.userId],
    groupId: ev.groupId,
    kind: 'waitlist_promoted',
    title: `You're in: ${ev.title}`,
    body: 'A spot opened up and you moved off the waitlist.',
    data: { eventId: ev.id },
    now: deps.clock(),
  });
  return next.userId;
}

registerJob('event_reminder', async (deps, payload) => {
  const [ev] = await deps.db.select().from(events).where(eq(events.id, payload.eventId));
  if (!ev || ev.cancelledAt) return;
  const going = await deps.db
    .select({ userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, ev.id), inArray(eventRsvps.status, ['going', 'maybe'])));
  // nobody answered yet → remind everyone in the group
  const userIds = going.length
    ? going.map((g) => g.userId)
    : (await deps.db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, ev.groupId))).map((m) => m.userId);
  await notify(deps.db, {
    userIds,
    groupId: ev.groupId,
    kind: 'event_reminder',
    title: ev.title,
    body: `Starts at ${ev.startsAt.toISOString()}`,
    data: { eventId: ev.id, category: 'rsvp' },
    now: deps.clock(),
  });
});

registerJob('materialize_events', async (deps) => {
  const groupIds = (await deps.db.selectDistinct({ g: events.groupId }).from(events).where(isNotNull(events.rrule))).map((r) => r.g);
  await ensureMaterialized(deps.db, groupIds, deps.clock());
  await enqueueJob(deps.db, {
    kind: 'materialize_events',
    runAt: new Date(deps.clock().getTime() + DAY),
    dedupeKey: `materialize:${new Date(deps.clock().getTime() + DAY).toISOString().slice(0, 10)}`,
  });
});

export const sqlNow = sql`now()`;
