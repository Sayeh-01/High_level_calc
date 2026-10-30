import { localDayKey, minutesBetween, overlaps, schemas } from '@circle/shared';
import { createHmac } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK_WINDOW_MS, clockCode, clockCodeValid } from '../clock';
import type { DbOrTx } from '../db/client';
import { groupMembers, leaves, shiftSwaps, shifts, timeEntries } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';

// Shifts, swaps and the time clock (v3.4, A6 Company). B9: overlapping shifts for one person are rejected; a swap needs a
// manager's approval; a clock-in code is never older than 60 s. Geofence clock-in is device-only (B5 Skip).

const WEEK = 7 * 86_400_000;

/** Rejects a shift that would overlap another of this person's shifts or their approved time off. Locks their member row. */
async function assertFree(tx: DbOrTx, groupId: string, userId: string, slot: { startsAt: Date; endsAt: Date }, tz: string, ignoreShiftId?: string) {
  await tx.select({ u: groupMembers.userId }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).for('update');
  const theirs = await tx.select().from(shifts).where(and(eq(shifts.groupId, groupId), eq(shifts.userId, userId), lt(shifts.startsAt, slot.endsAt), gte(shifts.endsAt, slot.startsAt)));
  if (theirs.some((s) => s.id !== ignoreShiftId && overlaps(s, slot))) throw conflict('overlapping_shift');
  const first = localDayKey(slot.startsAt.getTime(), tz);
  const last = localDayKey(slot.endsAt.getTime() - 1, tz);
  const off = await tx.select().from(leaves).where(and(eq(leaves.groupId, groupId), eq(leaves.userId, userId), eq(leaves.status, 'approved'), lte(leaves.startDay, last), gte(leaves.endDay, first)));
  if (off.length) throw conflict('on_time_off');
}

export function registerShiftRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';
  const sh = { module: 'shifts', tags: ['shifts'] };

  async function members(groupId: string) {
    return (await db.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).filter((m) => m.role !== 'guest' && m.role !== 'child');
  }

  r.get(`${base}/shifts`, { ...sh, perm: 'items.read', summary: 'Shifts in a time range (default: this week and next), swaps and approved time off', query: z.object({ from: z.string().optional(), to: z.string().optional() }) }, async (c, { query }) => {
    const group = c.get('group');
    const from = query.from ? new Date(query.from) : new Date(deps.clock().getTime() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + 2 * WEEK);
    const rows = await db.select().from(shifts).where(and(eq(shifts.groupId, group.id), lt(shifts.startsAt, to), gte(shifts.endsAt, from))).orderBy(asc(shifts.startsAt));
    const swaps = await db.select().from(shiftSwaps).where(and(eq(shiftSwaps.groupId, group.id), eq(shiftSwaps.status, 'pending'))).orderBy(desc(shiftSwaps.createdAt));
    const off = await db.select().from(leaves).where(and(eq(leaves.groupId, group.id), eq(leaves.status, 'approved'), gte(leaves.endDay, localDayKey(from.getTime(), group.timezone)), lte(leaves.startDay, localDayKey(to.getTime(), group.timezone))));
    return { shifts: rows, swaps, timeOff: off };
  });

  r.post(`${base}/shifts`, { ...sh, perm: 'approve', summary: 'Schedule a shift (optionally the same slot for several weeks)', body: schemas.shiftCreate }, async (c, { body }) => {
    const group = c.get('group');
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    const len = endsAt.getTime() - startsAt.getTime();
    if (len <= 0 || len > 16 * 3600_000) throw badRequest('bad_shift_length');
    if (body.userId && !(await members(group.id)).some((m) => m.u === body.userId)) throw badRequest('not_a_member');
    const rows = await db.transaction(async (tx) => {
      const out = [];
      for (let w = 0; w < body.repeatWeeks; w++) {
        const slot = { startsAt: new Date(startsAt.getTime() + w * WEEK), endsAt: new Date(endsAt.getTime() + w * WEEK) };
        if (body.userId) await assertFree(tx, group.id, body.userId, slot, group.timezone);
        const [s] = await tx.insert(shifts).values({ id: newId(), groupId: group.id, userId: body.userId, ...slot, label: body.label, createdBy: c.get('user').id, createdAt: deps.clock() }).returning();
        out.push(s);
      }
      if (body.userId && body.userId !== c.get('user').id)
        await notify(tx, { userIds: [body.userId], groupId: group.id, kind: 'shift', title: '🗓️ New shift', body: `${body.label ? `${body.label} · ` : ''}${out.length > 1 ? `${out.length} weeks` : ''}`.trim() || 'You have a new shift', data: { href: `/g/${group.id}/shifts` }, now: deps.clock() });
      return out;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'shifts' });
    return rows;
  });

  r.delete(`${base}/shifts/:shiftId`, { ...sh, perm: 'approve', summary: 'Remove a shift' }, async (c) => {
    const res = await db.delete(shifts).where(and(eq(shifts.id, c.req.param('shiftId')!), eq(shifts.groupId, c.get('group').id))).returning();
    if (!res.length) throw notFound();
    emit(c, { type: 'invalidate', groupId: res[0].groupId, entity: 'shifts' });
    return { ok: true };
  });

  // ── swaps: owner → colleague (or back to open), or someone claims an open shift; a manager always approves ─────
  r.post(`${base}/shifts/:shiftId/swap`, { ...sh, perm: 'items.read', summary: 'Ask to hand my shift to a colleague (or give it up), or to take an open shift', body: schemas.shiftSwapCreate }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const [s] = await db.select().from(shifts).where(and(eq(shifts.id, c.req.param('shiftId')!), eq(shifts.groupId, group.id)));
    if (!s) throw notFound();
    if (s.startsAt <= deps.clock()) throw conflict('shift_started');
    const claim = s.userId === null;
    if (claim ? body.toUserId !== me : s.userId !== me) throw forbidden();
    if (!claim && body.toUserId === me) throw badRequest('already_yours');
    if (body.toUserId && !(await members(group.id)).some((m) => m.u === body.toUserId)) throw badRequest('not_a_member');
    const open = await db.select().from(shiftSwaps).where(and(eq(shiftSwaps.shiftId, s.id), eq(shiftSwaps.status, 'pending')));
    if (open.length) throw conflict('swap_pending');
    const [row] = await db.transaction(async (tx) => {
      // claiming for yourself, or giving it back as open: nobody else needs to agree before the manager
      const peerDone = claim || body.toUserId === null;
      const ins = await tx.insert(shiftSwaps).values({ id: newId(), shiftId: s.id, groupId: group.id, requesterId: me, toUserId: body.toUserId, peerAcceptedAt: peerDone ? deps.clock() : null, createdAt: deps.clock() }).returning();
      if (!peerDone) await notify(tx, { userIds: [body.toUserId!], groupId: group.id, kind: 'shift_swap', title: '🔁 Shift swap', body: `${c.get('member').displayName} asks you to take a shift`, data: { href: `/g/${group.id}/shifts` }, now: deps.clock() });
      else await notifyManagers(tx, group.id, me, `${c.get('member').displayName} ${claim ? 'wants an open shift' : 'gives up a shift'}`);
      return ins;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'shifts' });
    return row;
  });

  async function notifyManagers(tx: DbOrTx, groupId: string, except: string, body: string) {
    const managers = (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).filter((m) => ['owner', 'admin', 'manager'].includes(m.role) && m.u !== except);
    await notify(tx, { userIds: managers.map((m) => m.u), groupId, kind: 'shift_swap', title: '🔁 Shift swap to approve', body, data: { href: `/g/${groupId}/shifts` }, now: deps.clock() });
  }

  async function loadSwap(c: Ctx, tx: DbOrTx) {
    const [sw] = await tx.select().from(shiftSwaps).where(and(eq(shiftSwaps.id, c.req.param('swapId')!), eq(shiftSwaps.groupId, c.get('group').id))).for('update');
    if (!sw) throw notFound();
    if (sw.status !== 'pending') throw conflict('swap_closed');
    return sw;
  }

  r.post(`${base}/shift-swaps/:swapId/accept`, { ...sh, perm: 'items.read', summary: 'The colleague agrees (a manager still has to approve)' }, async (c) => {
    const group = c.get('group');
    await db.transaction(async (tx) => {
      const sw = await loadSwap(c, tx);
      if (sw.toUserId !== c.get('user').id) throw forbidden();
      await tx.update(shiftSwaps).set({ peerAcceptedAt: deps.clock() }).where(eq(shiftSwaps.id, sw.id));
      await notifyManagers(tx, group.id, c.get('user').id, `${c.get('member').displayName} agreed to take a shift`);
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'shifts' });
    return { status: 'pending' };
  });

  r.post(`${base}/shift-swaps/:swapId/approve`, { ...sh, perm: 'approve', summary: 'A manager approves: the shift changes hands (overlaps re-checked)' }, async (c) => {
    const group = c.get('group');
    const res = await db.transaction(async (tx) => {
      const sw = await loadSwap(c, tx);
      if (!sw.peerAcceptedAt) throw conflict('waiting_for_colleague');
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, sw.shiftId)).for('update');
      if (sw.toUserId) await assertFree(tx, group.id, sw.toUserId, s, group.timezone, s.id);
      await tx.update(shifts).set({ userId: sw.toUserId }).where(eq(shifts.id, s.id));
      await tx.update(shiftSwaps).set({ status: 'approved', decidedBy: c.get('user').id }).where(eq(shiftSwaps.id, sw.id));
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'approved', entity: 'shift_swap', entityId: sw.id });
      await notify(tx, { userIds: [sw.requesterId, ...(sw.toUserId ? [sw.toUserId] : [])], groupId: group.id, kind: 'shift_swap', title: '✅ Shift swap approved', body: '', data: { href: `/g/${group.id}/shifts` }, now: deps.clock() });
      return { status: 'approved' };
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'shifts' });
    return res;
  });

  r.post(`${base}/shift-swaps/:swapId/reject`, { ...sh, perm: 'items.read', summary: 'Decline (colleague or manager) or withdraw (requester)' }, async (c) => {
    const group = c.get('group');
    const me = c.get('user').id;
    await db.transaction(async (tx) => {
      const sw = await loadSwap(c, tx);
      if (sw.toUserId !== me && sw.requesterId !== me && !actorCan(c, 'approve')) throw forbidden();
      await tx.update(shiftSwaps).set({ status: sw.requesterId === me ? 'cancelled' : 'rejected', decidedBy: me }).where(eq(shiftSwaps.id, sw.id));
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'shifts' });
    return { ok: true };
  });

  // ── time clock ──────────────────────────────────────────────────────────────
  const ck = { module: 'clock', tags: ['clock'] };
  const keyOf = (groupId: string) => createHmac('sha256', deps.env.authSecret).update(`clock:${groupId}`).digest('hex');

  r.get(`${base}/clock/code`, { ...ck, perm: 'approve', summary: 'The current clock-in code (show it as a QR at the door; it changes every 30 s)' }, async (c) => {
    const now = deps.clock().getTime();
    const windowEnd = (Math.floor(now / CLOCK_WINDOW_MS) + 1) * CLOCK_WINDOW_MS;
    return { code: clockCode(keyOf(c.get('group').id), now), validUntil: new Date(windowEnd + CLOCK_WINDOW_MS), refreshAt: new Date(windowEnd) };
  });

  async function punch(c: Ctx, code: string, kind: 'in' | 'out') {
    const group = c.get('group');
    const me = c.get('user').id;
    const now = deps.clock();
    if (!clockCodeValid(keyOf(group.id), code, now.getTime())) throw new HttpError(400, 'code_expired');
    return db.transaction(async (tx) => {
      const [open] = await tx.select().from(timeEntries).where(and(eq(timeEntries.groupId, group.id), eq(timeEntries.userId, me), isNull(timeEntries.outAt))).for('update');
      if (kind === 'in') {
        if (open) throw conflict('already_clocked_in');
        const [shift] = await tx
          .select()
          .from(shifts)
          .where(and(eq(shifts.groupId, group.id), eq(shifts.userId, me), lte(shifts.startsAt, new Date(now.getTime() + 2 * 3600_000)), gte(shifts.endsAt, now)))
          .orderBy(asc(shifts.startsAt))
          .limit(1);
        const [row] = await tx.insert(timeEntries).values({ id: newId(), groupId: group.id, userId: me, shiftId: shift?.id ?? null, inAt: now, source: 'qr' }).returning();
        return row;
      }
      if (!open) throw conflict('not_clocked_in');
      const [row] = await tx.update(timeEntries).set({ outAt: now }).where(eq(timeEntries.id, open.id)).returning();
      return row;
    });
  }
  r.post(`${base}/clock/in`, { ...ck, perm: 'items.read', summary: 'Clock in with the code from the QR (or typed)', body: schemas.clockPunch }, async (c, { body }) => {
    const row = await punch(c, body.code, 'in');
    emit(c, { type: 'invalidate', groupId: c.get('group').id, entity: 'clock' });
    return row;
  });
  r.post(`${base}/clock/out`, { ...ck, perm: 'items.read', summary: 'Clock out with the current code', body: schemas.clockPunch }, async (c, { body }) => {
    const row = await punch(c, body.code, 'out');
    emit(c, { type: 'invalidate', groupId: c.get('group').id, entity: 'clock' });
    return row;
  });

  r.post(`${base}/clock/entries/:entryId/close`, { ...ck, perm: 'approve', summary: 'Close an entry someone forgot to clock out of', body: schemas.clockClose }, async (c, { body }) => {
    const group = c.get('group');
    const [e] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, c.req.param('entryId')!), eq(timeEntries.groupId, group.id)));
    if (!e) throw notFound();
    if (e.outAt) throw conflict('already_closed');
    const outAt = new Date(body.outAt);
    if (outAt <= e.inAt || outAt > deps.clock()) throw badRequest('bad_time');
    await db.update(timeEntries).set({ outAt, closedBy: c.get('user').id }).where(eq(timeEntries.id, e.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'clock' });
    return { ok: true };
  });

  r.get(`${base}/clock/me`, { ...ck, perm: 'items.read', summary: 'Am I clocked in? My recent entries' }, async (c) => {
    const rows = await db.select().from(timeEntries).where(and(eq(timeEntries.groupId, c.get('group').id), eq(timeEntries.userId, c.get('user').id))).orderBy(desc(timeEntries.inAt)).limit(30);
    return { open: rows.find((e) => !e.outAt) ?? null, entries: rows };
  });

  /** Hours for payroll: one row per person; the total is the sum of the rows (B9 v3.x reports). */
  r.get(`${base}/clock/report`, { ...ck, perm: 'approve', summary: 'Hours per person in a range (closed entries)', query: z.object({ from: z.string(), to: z.string() }) }, async (c, { query }) => {
    const group = c.get('group');
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!(from < to)) throw badRequest('bad_range');
    const rows = await db.select().from(timeEntries).where(and(eq(timeEntries.groupId, group.id), gte(timeEntries.inAt, from), lt(timeEntries.inAt, to)));
    const open = rows.filter((e) => !e.outAt);
    const byUser = new Map<string, { userId: string; minutes: number; entries: number }>();
    for (const e of rows.filter((x) => x.outAt)) {
      const r = byUser.get(e.userId) ?? { userId: e.userId, minutes: 0, entries: 0 };
      r.minutes += minutesBetween(e.inAt, e.outAt!);
      r.entries++;
      byUser.set(e.userId, r);
    }
    const people = [...byUser.values()].sort((a, b) => b.minutes - a.minutes);
    return { from, to, rows: people, totalMinutes: people.reduce((s, r) => s + r.minutes, 0), stillOpen: open.map((e) => ({ id: e.id, userId: e.userId, inAt: e.inAt })) };
  });
}
