import { balanceTeams, schemas } from '@circle/shared';
import { and, count, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { carpoolOffers, carpoolRiders, eventRsvps, events, groupMembers, matchVotes, memberSkills } from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { emit, type Router } from '../http';
import { newId } from '../ids';

const DEFAULT_SKILL = 5;

async function eventInGroup(db: DbOrTx, groupId: string, eventId: string) {
  const [ev] = await db.select().from(events).where(and(eq(events.id, eventId), eq(events.groupId, groupId)));
  if (!ev || ev.rrule) throw notFound();
  return ev;
}

async function goingIds(db: DbOrTx, eventId: string) {
  return (await db.select({ u: eventRsvps.userId }).from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, 'going')))).map((r) => r.u);
}

export function registerSportRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const mod = { module: 'teams', tags: ['teams'] };
  const base = '/groups/:groupId';

  r.get(`${base}/teams/skills`, { ...mod, perm: 'items.read', summary: 'Skill ratings' }, async (c) => {
    return db.select({ userId: memberSkills.userId, skill: memberSkills.skill }).from(memberSkills).where(eq(memberSkills.groupId, c.get('group').id));
  });

  r.put(`${base}/teams/skills/:userId`, { ...mod, perm: 'approve', summary: 'Rate a player (captain/coach)', body: schemas.skillSet }, async (c, { body }) => {
    const group = c.get('group');
    const userId = c.req.param('userId')!;
    const [m] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)));
    if (!m) throw notFound();
    await db
      .insert(memberSkills)
      .values({ groupId: group.id, userId, skill: body.skill, updatedBy: c.get('user').id, updatedAt: deps.clock() })
      .onConflictDoUpdate({ target: [memberSkills.groupId, memberSkills.userId], set: { skill: body.skill, updatedBy: c.get('user').id, updatedAt: deps.clock() } });
    return { ok: true };
  });

  r.post(`${base}/events/:eventId/teams`, { ...mod, perm: 'items.read', summary: 'Split the players going into two balanced teams' }, async (c) => {
    const group = c.get('group');
    const ev = await eventInGroup(db, group.id, c.req.param('eventId')!);
    const going = (await goingIds(db, ev.id)).filter((u) => !u.startsWith('guest:'));
    if (going.length < 2) throw badRequest('need_two_players');
    const skills = await db.select().from(memberSkills).where(and(eq(memberSkills.groupId, group.id), inArray(memberSkills.userId, going)));
    const players = going.map((id) => ({ id, skill: skills.find((s) => s.userId === id)?.skill ?? DEFAULT_SKILL }));
    return balanceTeams(players);
  });

  // ── man of the match ────────────────────────────────────────────────────────
  r.get(`${base}/events/:eventId/motm`, { ...mod, perm: 'items.read', summary: 'Man-of-the-match votes' }, async (c) => {
    const group = c.get('group');
    const ev = await eventInGroup(db, group.id, c.req.param('eventId')!);
    const votes = await db.select().from(matchVotes).where(and(eq(matchVotes.eventId, ev.id), eq(matchVotes.groupId, group.id)));
    const tally: Record<string, number> = {};
    for (const v of votes) tally[v.nomineeId] = (tally[v.nomineeId] ?? 0) + 1;
    const top = Math.max(0, ...Object.values(tally));
    return {
      open: ev.startsAt.getTime() <= deps.clock().getTime(),
      tally,
      winners: top ? Object.keys(tally).filter((k) => tally[k] === top) : [],
      myVote: votes.find((v) => v.voterId === c.get('user').id)?.nomineeId ?? null,
      voters: votes.length,
    };
  });

  r.post(`${base}/events/:eventId/motm`, { ...mod, perm: 'items.read', summary: 'Vote for man of the match (once per player per match)', body: schemas.motmVote }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const ev = await eventInGroup(db, group.id, c.req.param('eventId')!);
    if (ev.startsAt.getTime() > deps.clock().getTime()) throw conflict('match_not_started');
    const going = await goingIds(db, ev.id);
    if (!going.includes(user.id)) throw forbidden('only_players_vote');
    if (!going.includes(body.nomineeId)) throw badRequest('nominee_did_not_play');
    if (body.nomineeId === user.id) throw badRequest('no_self_vote');
    const inserted = await db.insert(matchVotes).values({ eventId: ev.id, groupId: group.id, voterId: user.id, nomineeId: body.nomineeId, createdAt: deps.clock() }).onConflictDoNothing().returning();
    if (inserted.length === 0) throw conflict('already_voted');
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events', id: ev.id });
    return { ok: true };
  });

  // ── attendance & season leaderboard ─────────────────────────────────────────
  r.get(`${base}/teams/stats`, { ...mod, perm: 'items.read', summary: 'Attendance and man-of-the-match leaderboard for the last N days' }, async (c) => {
    const group = c.get('group');
    const days = Math.min(365, Math.max(7, Number(c.req.query('days') ?? 120)));
    const now = deps.clock();
    const since = new Date(now.getTime() - days * 86_400_000);
    const past = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.groupId, group.id), isNull(events.rrule), isNull(events.cancelledAt), gte(events.startsAt, since), lt(events.startsAt, now)));
    const ids = past.map((e) => e.id);
    const members = await db.select({ userId: groupMembers.userId, name: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const attended = ids.length
      ? await db.select({ u: eventRsvps.userId, n: count() }).from(eventRsvps).where(and(inArray(eventRsvps.eventId, ids), eq(eventRsvps.status, 'going'))).groupBy(eventRsvps.userId)
      : [];
    const votes = ids.length ? await db.select().from(matchVotes).where(inArray(matchVotes.eventId, ids)) : [];
    const wins: Record<string, number> = {};
    for (const id of ids) {
      const t: Record<string, number> = {};
      for (const v of votes.filter((x) => x.eventId === id)) t[v.nomineeId] = (t[v.nomineeId] ?? 0) + 1;
      const top = Math.max(0, ...Object.values(t));
      if (top) for (const k of Object.keys(t).filter((k) => t[k] === top)) wins[k] = (wins[k] ?? 0) + 1;
    }
    const rows = members.map((m) => {
      const a = attended.find((x) => x.u === m.userId)?.n ?? 0;
      return { userId: m.userId, name: m.name, attended: a, rate: ids.length ? Math.round((a / ids.length) * 100) : 0, motm: wins[m.userId] ?? 0 };
    });
    rows.sort((x, y) => y.motm - x.motm || y.attended - x.attended || x.name.localeCompare(y.name));
    return { matches: ids.length, days, rows };
  });

  // ── carpool board ───────────────────────────────────────────────────────────
  r.get(`${base}/events/:eventId/carpool`, { ...mod, perm: 'items.read', summary: 'Rides offered for this event' }, async (c) => {
    const group = c.get('group');
    const ev = await eventInGroup(db, group.id, c.req.param('eventId')!);
    const offers = await db.select().from(carpoolOffers).where(and(eq(carpoolOffers.eventId, ev.id), eq(carpoolOffers.groupId, group.id)));
    const riders = offers.length ? await db.select().from(carpoolRiders).where(inArray(carpoolRiders.offerId, offers.map((o) => o.id))) : [];
    return offers.map((o) => ({ ...o, riders: riders.filter((r) => r.offerId === o.id).map((r) => r.userId) }));
  });

  r.post(`${base}/events/:eventId/carpool`, { ...mod, perm: 'items.read', summary: 'Offer seats in your car', body: schemas.carpoolOffer }, async (c, { body }) => {
    const group = c.get('group');
    const ev = await eventInGroup(db, group.id, c.req.param('eventId')!);
    const [row] = await db.insert(carpoolOffers).values({ id: newId(), groupId: group.id, eventId: ev.id, driverId: c.get('user').id, seats: body.seats, note: body.note ?? null }).returning();
    await logActivity(db, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'carpool', entityId: row.id, summary: `${body.seats} seats` });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events', id: ev.id });
    return row;
  });

  r.post(`${base}/carpool/:offerId/join`, { ...mod, perm: 'items.read', summary: 'Take a seat' }, async (c) => {
    const group = c.get('group');
    const user = c.get('user');
    await db.transaction(async (tx) => {
      const [offer] = await tx.select().from(carpoolOffers).where(and(eq(carpoolOffers.id, c.req.param('offerId')!), eq(carpoolOffers.groupId, group.id))).for('update');
      if (!offer) throw notFound();
      if (offer.driverId === user.id) throw badRequest('own_car');
      const [{ n }] = await tx.select({ n: count() }).from(carpoolRiders).where(eq(carpoolRiders.offerId, offer.id));
      if (n >= offer.seats) throw conflict('car_full');
      const res = await tx.insert(carpoolRiders).values({ offerId: offer.id, groupId: group.id, eventId: offer.eventId, userId: user.id }).onConflictDoNothing().returning();
      if (!res.length) throw conflict('already_riding');
      await notify(tx, { userIds: [offer.driverId], groupId: group.id, kind: 'carpool', title: '🚗', body: `${c.get('member').displayName} joined your car`, data: { eventId: offer.eventId }, push: false, now: deps.clock() });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events' });
    return { ok: true };
  });

  r.post(`${base}/carpool/:offerId/leave`, { ...mod, perm: 'items.read', summary: 'Give up your seat' }, async (c) => {
    const group = c.get('group');
    const res = await db
      .delete(carpoolRiders)
      .where(and(eq(carpoolRiders.offerId, c.req.param('offerId')!), eq(carpoolRiders.groupId, group.id), eq(carpoolRiders.userId, c.get('user').id)))
      .returning();
    if (!res.length) throw notFound();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events' });
    return { ok: true };
  });

  r.delete(`${base}/carpool/:offerId`, { ...mod, perm: 'items.read', summary: 'Withdraw your offer' }, async (c) => {
    const group = c.get('group');
    const [offer] = await db.select().from(carpoolOffers).where(and(eq(carpoolOffers.id, c.req.param('offerId')!), eq(carpoolOffers.groupId, group.id)));
    if (!offer) throw notFound();
    if (offer.driverId !== c.get('user').id) throw forbidden();
    await db.delete(carpoolOffers).where(eq(carpoolOffers.id, offer.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'events' });
    return { ok: true };
  });
}

