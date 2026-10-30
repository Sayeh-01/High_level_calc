import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantEntitlement } from '../src/entitlements';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let captain: Client;
let players: Client[] = [];
let g: { id: string; code: string };

beforeAll(async () => {
  t = await setup();
  captain = await t.signIn('captain@example.com', 'Captain');
  g = await makeGroup(captain, 'sport');
  // 16 people is over the Free cap (v2.4): the admin path grants this team Group Pro
  await grantEntitlement(t.db, { scope: 'group', subjectId: g.id, plan: 'group_pro', grantedBy: 'test', now: t.now() });
  for (let i = 1; i <= 15; i++) {
    const p = await t.signIn(`p${i}@example.com`, `Player ${i}`);
    await join(p, g.code);
    players.push(p);
  }
});
afterAll(() => t.close());

async function newMatch(capacity = 12) {
  const res = await captain.post(`/api/groups/${g.id}/events`, { title: 'Match', startsAt: '2026-11-12T21:00:00+02:00', capacity, waitlist: true });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

describe('capacity + waitlist (B9 v1.0 #7)', () => {
  it('the 13th RSVP is waitlisted; when #5 cancels the waitlisted user becomes Going', async () => {
    const id = await newMatch(12);
    for (let i = 0; i < 12; i++) {
      const r = await players[i].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
      expect(r.body.status).toBe('going');
    }
    const thirteenth = await players[12].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
    expect(thirteenth.body).toMatchObject({ status: 'waitlist', waitlistPos: 1 });
    const fourteenth = await players[13].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
    expect(fourteenth.body).toMatchObject({ status: 'waitlist', waitlistPos: 2 });

    const cancel = await players[4].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'no' });
    expect(cancel.body.promoted).toBe(players[12].user.id);
    const detail = await captain.get(`/api/groups/${g.id}/events/${id}`);
    const status = (c: Client) => detail.body.rsvps.find((r: any) => r.userId === c.user.id)?.status;
    expect(status(players[12])).toBe('going');
    expect(status(players[13])).toBe('waitlist');
    expect(detail.body.rsvps.filter((r: any) => r.status === 'going')).toHaveLength(12);
    // the promoted player is told
    const inbox = await players[12].get('/api/me/inbox');
    expect(inbox.body.some((n: any) => n.kind === 'waitlist_promoted')).toBe(true);
  });

  it('two concurrent RSVPs for the last spot → exactly one gets it', async () => {
    const id = await newMatch(3);
    await players[0].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
    await players[1].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
    const [x, y] = await Promise.all([
      players[2].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' }),
      players[3].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' }),
    ]);
    expect([x.body.status, y.body.status].sort()).toEqual(['going', 'waitlist']);
    const detail = await captain.get(`/api/groups/${g.id}/events/${id}`);
    expect(detail.body.rsvps.filter((r: any) => r.status === 'going')).toHaveLength(3);
  });

  it('many concurrent RSVPs never overfill', async () => {
    const id = await newMatch(5);
    const results = await Promise.all(players.map((p) => p.post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' })));
    expect(results.filter((r) => r.body.status === 'going')).toHaveLength(5);
    expect(results.filter((r) => r.body.status === 'waitlist')).toHaveLength(10);
    const positions = results.filter((r) => r.body.status === 'waitlist').map((r) => r.body.waitlistPos).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('without a waitlist a full event refuses', async () => {
    const res = await captain.post(`/api/groups/${g.id}/events`, { title: 'Dinner', startsAt: '2026-11-12T21:00:00+02:00', capacity: 1, waitlist: false });
    await players[0].post(`/api/groups/${g.id}/events/${res.body.id}/rsvp`, { status: 'going' });
    const second = await players[1].post(`/api/groups/${g.id}/events/${res.body.id}/rsvp`, { status: 'going' });
    expect(second.status).toBe(409);
  });

  it('raising capacity promotes from the waitlist', async () => {
    const id = await newMatch(1);
    await players[0].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
    await players[1].post(`/api/groups/${g.id}/events/${id}/rsvp`, { status: 'going' });
    await captain.patch(`/api/groups/${g.id}/events/${id}`, { capacity: 2 });
    const detail = await captain.get(`/api/groups/${g.id}/events/${id}`);
    expect(detail.body.rsvps.filter((r: any) => r.status === 'going')).toHaveLength(2);
  });
});

describe('recurring events', () => {
  it('a weekly series is materialized into dated occurrences in the group timezone', async () => {
    const res = await captain.post(`/api/groups/${g.id}/events`, { title: 'Training', startsAt: '2026-11-03T19:00:00+02:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    expect(res.status).toBe(200);
    const list = await captain.get(`/api/groups/${g.id}/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z`);
    const training = list.body.filter((e: any) => e.title === 'Training');
    expect(training.map((e: any) => e.startsAt)).toEqual([
      '2026-11-03T17:00:00.000Z',
      '2026-11-10T17:00:00.000Z',
      '2026-11-17T17:00:00.000Z',
      '2026-11-24T17:00:00.000Z',
    ]);
    // RSVP is per occurrence
    await players[0].post(`/api/groups/${g.id}/events/${training[0].id}/rsvp`, { status: 'going' });
    const again = await captain.get(`/api/groups/${g.id}/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z`);
    const t2 = again.body.filter((e: any) => e.title === 'Training');
    expect(t2[0].going).toBe(1);
    expect(t2[1].going).toBe(0);
  });

  it('reminder job fires at start − offset and notifies those going', async () => {
    const res = await captain.post(`/api/groups/${g.id}/events`, { title: 'Friendly', startsAt: '2026-11-02T20:00:00+02:00', reminderMin: 60 });
    await players[5].post(`/api/groups/${g.id}/events/${res.body.id}/rsvp`, { status: 'going' });
    t.setNow('2026-11-02T16:59:00Z');
    await t.runJobs();
    let inbox = await players[5].get('/api/me/inbox');
    expect(inbox.body.some((n: any) => n.kind === 'event_reminder' && n.title === 'Friendly')).toBe(false);
    t.setNow('2026-11-02T17:00:00Z');
    await t.runJobs();
    inbox = await players[5].get('/api/me/inbox');
    expect(inbox.body.some((n: any) => n.kind === 'event_reminder' && n.title === 'Friendly')).toBe(true);
  });
});
