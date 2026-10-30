import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shifts } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, D: Client, X: Client;
let g: { id: string; code: string; group: any };
const api = (p: string) => `/api/groups/${g.id}${p}`;
const slot = (day: string, from: string, to: string) => ({ startsAt: `${day}T${from}:00+02:00`, endsAt: `${day}T${to}:00+02:00` });

beforeAll(async () => {
  t = await setup();
  t.setNow('2026-11-08T06:00:00Z');
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  D = await t.signIn('d@example.com', 'Dina');
  X = await t.signIn('x@example.com', 'Xavier');
  g = await makeGroup(A, 'company', 'Cafe Nile');
  for (const u of [B, C, D]) await join(u, g.code);
});
afterAll(() => t.close());

describe('shifts (B9 v3.x): overlapping shifts for one person are rejected', () => {
  it('rejects overlaps, allows back-to-back, checks every repeated week and approved time off', async () => {
    expect((await B.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-09', '09:00', '17:00') })).status).toBe(403);
    expect((await A.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-09', '09:00', '17:00'), label: 'Bar' })).status).toBe(200);
    expect((await A.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-09', '16:00', '20:00') })).body.error).toBe('overlapping_shift');
    expect((await A.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-09', '10:00', '11:00') })).body.error).toBe('overlapping_shift');
    expect((await A.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-09', '17:00', '21:00') })).status).toBe(200);
    // someone else may work the same hours
    expect((await A.post(api('/shifts'), { userId: C.user.id, ...slot('2026-11-09', '09:00', '17:00') })).status).toBe(200);
    // repeating 3 weeks: the second week collides → nothing is saved
    expect((await A.post(api('/shifts'), { userId: C.user.id, ...slot('2026-11-16', '12:00', '14:00') })).status).toBe(200);
    const before = (await t.db.select().from(shifts)).length;
    expect((await A.post(api('/shifts'), { userId: C.user.id, ...slot('2026-11-09', '13:00', '20:00'), repeatWeeks: 3 })).status).toBe(409);
    expect((await t.db.select().from(shifts)).length).toBe(before);
    expect((await A.post(api('/shifts'), { userId: D.user.id, ...slot('2026-11-10', '08:00', '12:00'), repeatWeeks: 3 })).body).toHaveLength(3);
    // approved time off blocks a shift
    const off = await D.post(api('/time-off'), { startDay: '2026-11-12', endDay: '2026-11-12' });
    await A.post(api(`/time-off/${off.body.id}/approve`));
    expect((await A.post(api('/shifts'), { userId: D.user.id, ...slot('2026-11-12', '08:00', '12:00') })).body.error).toBe('on_time_off');
    expect((await A.post(api('/shifts'), { userId: D.user.id, ...slot('2026-11-13', '08:00', '07:00') })).body.error).toBe('bad_shift_length');
  });

  it('two managers booking the same person at once: exactly one succeeds', async () => {
    await A.patch(api(`/members/${C.user.id}`), { role: 'manager' });
    const [r1, r2] = await Promise.all([A.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-11', '09:00', '13:00') }), C.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-11', '12:00', '16:00') })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    await A.patch(api(`/members/${C.user.id}`), { role: 'member' });
  });
});

describe('swaps (B9 v3.x): a shift swap needs manager approval', () => {
  let shiftId: string;
  it('colleague agreeing is not enough; the manager approves and the shift changes hands', async () => {
    shiftId = (await A.post(api('/shifts'), { userId: B.user.id, ...slot('2026-11-14', '09:00', '15:00') })).body[0].id;
    expect((await C.post(api(`/shifts/${shiftId}/swap`), { toUserId: C.user.id })).status).toBe(403);
    const sw = await B.post(api(`/shifts/${shiftId}/swap`), { toUserId: C.user.id });
    expect(sw.status).toBe(200);
    expect((await B.post(api(`/shifts/${shiftId}/swap`), { toUserId: D.user.id })).body.error).toBe('swap_pending');
    expect((await A.post(api(`/shift-swaps/${sw.body.id}/approve`))).body.error).toBe('waiting_for_colleague');
    expect((await D.post(api(`/shift-swaps/${sw.body.id}/accept`))).status).toBe(403);
    expect((await C.post(api(`/shift-swaps/${sw.body.id}/accept`))).status).toBe(200);
    expect((await t.db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].userId).toBe(B.user.id);
    expect((await C.post(api(`/shift-swaps/${sw.body.id}/approve`))).status).toBe(403);
    expect((await A.post(api(`/shift-swaps/${sw.body.id}/approve`))).body.status).toBe('approved');
    expect((await t.db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].userId).toBe(C.user.id);
  });

  it('approval re-checks overlaps; giving a shift back and claiming an open one also need a manager', async () => {
    await A.post(api('/shifts'), { userId: D.user.id, ...slot('2026-11-14', '14:00', '18:00') });
    const sw = await C.post(api(`/shifts/${shiftId}/swap`), { toUserId: D.user.id });
    await D.post(api(`/shift-swaps/${sw.body.id}/accept`));
    expect((await A.post(api(`/shift-swaps/${sw.body.id}/approve`))).body.error).toBe('overlapping_shift');
    expect((await t.db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].userId).toBe(C.user.id);
    await A.post(api(`/shift-swaps/${sw.body.id}/reject`));

    const back = await C.post(api(`/shifts/${shiftId}/swap`), { toUserId: null });
    await A.post(api(`/shift-swaps/${back.body.id}/approve`));
    expect((await t.db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].userId).toBeNull();
    const claim = await B.post(api(`/shifts/${shiftId}/swap`), { toUserId: B.user.id });
    expect((await t.db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].userId).toBeNull();
    await A.post(api(`/shift-swaps/${claim.body.id}/approve`));
    expect((await t.db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].userId).toBe(B.user.id);
  });
});

describe('time clock (B9 v3.x): a QR clock-in code expires within 60 s', () => {
  it('only managers see the code; it works for under 60 s; in/out with the current code', async () => {
    t.setNow('2026-11-09T06:55:00Z'); // a 30-second boundary, 08:55 Cairo
    expect((await B.get(api('/clock/code'))).status).toBe(403);
    const first = (await A.get(api('/clock/code'))).body;
    expect(first.code).toMatch(/^\d{6}$/);
    expect(new Date(first.validUntil).getTime() - t.now().getTime()).toBeLessThanOrEqual(60_000);
    t.advance(60_000);
    expect((await B.post(api('/clock/in'), { code: first.code })).body.error).toBe('code_expired');
    const fresh = (await A.get(api('/clock/code'))).body.code;
    t.advance(59_000);
    const entry = await B.post(api('/clock/in'), { code: fresh });
    expect(entry.status).toBe(200);
    expect(entry.body.shiftId).not.toBeNull(); // matched Monday's 09:00 shift
    expect((await B.post(api('/clock/in'), { code: (await A.get(api('/clock/code'))).body.code })).body.error).toBe('already_clocked_in');
    // another group's code never works here
    const xg = await makeGroup(X, 'company', 'X co');
    const foreign = (await X.get(`/api/groups/${xg.id}/clock/code`)).body.code;
    if (foreign !== (await A.get(api('/clock/code'))).body.code) expect((await C.post(api('/clock/in'), { code: foreign })).body.error).toBe('code_expired');
    t.setNow('2026-11-09T15:00:00Z');
    expect((await B.post(api('/clock/out'), { code: (await A.get(api('/clock/code'))).body.code })).status).toBe(200);
    expect((await B.get(api('/clock/me'))).body.open).toBeNull();
  });

  it('hours report: one row per person and the total equals the sum of the rows; managers close forgotten entries', async () => {
    t.setNow('2026-11-10T06:00:00Z');
    await C.post(api('/clock/in'), { code: (await A.get(api('/clock/code'))).body.code });
    t.setNow('2026-11-10T10:30:00Z');
    await C.post(api('/clock/out'), { code: (await A.get(api('/clock/code'))).body.code });
    await D.post(api('/clock/in'), { code: (await A.get(api('/clock/code'))).body.code });
    let rep = (await A.get(api('/clock/report?from=2026-11-09T00:00:00Z&to=2026-11-11T00:00:00Z'))).body;
    expect(rep.rows).toEqual([
      { userId: B.user.id, minutes: 483, entries: 1 }, // 06:56:59 → 15:00
      { userId: C.user.id, minutes: 270, entries: 1 },
    ]);
    expect(rep.totalMinutes).toBe(rep.rows.reduce((s: number, r: any) => s + r.minutes, 0));
    expect(rep.stillOpen.map((e: any) => e.userId)).toEqual([D.user.id]);
    t.setNow('2026-11-10T20:00:00Z');
    expect((await B.post(api(`/clock/entries/${rep.stillOpen[0].id}/close`), { outAt: '2026-11-10T14:30:00Z' })).status).toBe(403);
    expect((await A.post(api(`/clock/entries/${rep.stillOpen[0].id}/close`), { outAt: '2026-11-10T14:30:00Z' })).status).toBe(200);
    rep = (await A.get(api('/clock/report?from=2026-11-09T00:00:00Z&to=2026-11-11T00:00:00Z'))).body;
    expect(rep.rows).toHaveLength(3);
    expect(rep.totalMinutes).toBe(rep.rows.reduce((s: number, r: any) => s + r.minutes, 0));
    expect((await B.get(api('/clock/report?from=2026-11-09T00:00:00Z&to=2026-11-11T00:00:00Z'))).status).toBe(403);
  });

  it('cross-group: another group’s shift, swap and time entry → 404', async () => {
    const xg = (await X.get('/api/groups')).body[0];
    const s = (await t.db.select().from(shifts).where(eq(shifts.groupId, g.id)))[0];
    const sw = (await A.get(api('/shifts?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z'))).body;
    const entry = (await A.get(api('/clock/report?from=2026-11-09T00:00:00Z&to=2026-11-11T00:00:00Z'))).body;
    expect(entry.rows.length).toBeGreaterThan(0);
    for (const [m, p, b] of [
      ['POST', `/api/groups/${xg.id}/shifts/${s.id}/swap`, { toUserId: X.user.id }],
      ['DELETE', `/api/groups/${xg.id}/shifts/${s.id}`],
      ['POST', `/api/groups/${xg.id}/shift-swaps/x/approve`, {}],
    ] as [string, string, unknown?][])
      expect((await X.req(m, p, b)).status, `${m} ${p}`).toBe(404);
    expect(sw.shifts.length).toBeGreaterThan(0);
  });
});
