import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let cap: Client;
let players: Client[] = [];
let g: { id: string; code: string };

beforeAll(async () => {
  t = await setup();
  cap = await t.signIn('cap@example.com', 'Captain');
  g = await makeGroup(cap, 'sport', 'Five-a-side');
  for (let i = 0; i < 5; i++) {
    const p = await t.signIn(`p${i}@example.com`, `P${i}`);
    await join(p, g.code);
    players.push(p);
  }
});
afterAll(() => t.close());

async function playedMatch(goingClients: Client[], startsAt = '2026-11-01T19:00:00Z') {
  t.setNow('2026-10-31T12:00:00Z');
  const ev = await cap.post(`/api/groups/${g.id}/events`, { title: 'Match', startsAt });
  for (const c of goingClients) await c.post(`/api/groups/${g.id}/events/${ev.body.id}/rsvp`, { status: 'going' });
  return ev.body.id as string;
}

describe('team balancer endpoint', () => {
  it('splits Going players using captain ratings (unrated = 5)', async () => {
    const id = await playedMatch([cap, ...players.slice(0, 3)]);
    await cap.put(`/api/groups/${g.id}/teams/skills/${players[0].user.id}`, { skill: 9 });
    await cap.put(`/api/groups/${g.id}/teams/skills/${players[1].user.id}`, { skill: 1 });
    expect((await players[2].put(`/api/groups/${g.id}/teams/skills/${players[2].user.id}`, { skill: 10 })).status).toBe(403);
    const teams = await cap.post(`/api/groups/${g.id}/events/${id}/teams`);
    expect(teams.body.a).toHaveLength(2);
    expect(teams.body.b).toHaveLength(2);
    expect(teams.body.diff).toBe(0); // 9+1 vs 5+5
  });
});

describe('man of the match (B9 v1.3)', () => {
  it('one vote per player per match; only players vote; only for players; not before kick-off', async () => {
    const id = await playedMatch([cap, players[0], players[1], players[2]]);
    expect((await players[0].post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[1].user.id })).status).toBe(409); // not started
    t.setNow('2026-11-01T21:00:00Z');
    expect((await players[0].post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[1].user.id })).status).toBe(200);
    expect((await players[0].post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[2].user.id })).status).toBe(409); // second vote
    expect((await players[3].post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[1].user.id })).status).toBe(403); // didn't play
    expect((await players[2].post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[3].user.id })).status).toBe(400); // nominee didn't play
    expect((await players[2].post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[2].user.id })).status).toBe(400); // self
    // two concurrent votes from the same player → exactly one counts
    const [a, b] = await Promise.all([
      cap.post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[1].user.id }),
      cap.post(`/api/groups/${g.id}/events/${id}/motm`, { nomineeId: players[2].user.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const res = await cap.get(`/api/groups/${g.id}/events/${id}/motm`);
    expect(res.body.voters).toBe(2);
    expect(res.body.myVote).not.toBeNull();
  });

  it('attendance stats and season leaderboard', async () => {
    t.setNow('2026-11-20T12:00:00Z');
    const stats = await cap.get(`/api/groups/${g.id}/teams/stats?days=60`);
    const row = (c: Client) => stats.body.rows.find((r: any) => r.userId === c.user.id);
    expect(stats.body.matches).toBeGreaterThanOrEqual(2);
    expect(row(players[1]).motm).toBeGreaterThanOrEqual(1);
    expect(row(players[0]).attended).toBe(2);
    expect(row(players[4]).attended).toBe(0);
    expect(stats.body.rows[0].motm).toBeGreaterThanOrEqual(stats.body.rows[stats.body.rows.length - 1].motm);
  });
});

describe('carpool', () => {
  it('seats can’t be overbooked; one car per rider per match', async () => {
    const id = await playedMatch([cap], '2026-11-25T19:00:00Z');
    const offer = await cap.post(`/api/groups/${g.id}/events/${id}/carpool`, { seats: 2, note: 'From Dokki' });
    const results = await Promise.all(players.slice(0, 3).map((p) => p.post(`/api/groups/${g.id}/carpool/${offer.body.id}/join`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const second = await players[3].post(`/api/groups/${g.id}/events/${id}/carpool`, { seats: 3 });
    const rider = results.findIndex((r) => r.status === 200);
    expect((await players[rider].post(`/api/groups/${g.id}/carpool/${second.body.id}/join`)).status).toBe(409);
    await players[rider].post(`/api/groups/${g.id}/carpool/${offer.body.id}/leave`);
    expect((await players[rider].post(`/api/groups/${g.id}/carpool/${second.body.id}/join`)).status).toBe(200);
    const board = await cap.get(`/api/groups/${g.id}/events/${id}/carpool`);
    expect(board.body.map((o: any) => o.riders.length).sort()).toEqual([1, 1]);
  });
});

describe('study pack', () => {
  let s: { id: string; code: string };
  let A: Client, B: Client;
  beforeAll(async () => {
    A = await t.signIn('sa@example.com', 'Sara');
    B = await t.signIn('sb@example.com', 'Bilal');
    s = await makeGroup(A, 'study', 'Masters');
    await join(B, s.code);
  });

  it('focus sessions give minutes today and a group streak', async () => {
    t.setNow('2026-11-02T18:00:00Z');
    await A.post(`/api/groups/${s.id}/focus/start`);
    t.setNow('2026-11-02T18:25:00Z');
    let f = await B.get(`/api/groups/${s.id}/focus`);
    expect(f.body.active.map((x: any) => x.userId)).toEqual([A.user.id]);
    await A.post(`/api/groups/${s.id}/focus/stop`);
    f = await A.get(`/api/groups/${s.id}/focus`);
    expect(f.body.minutesToday[A.user.id]).toBe(25);
    expect(f.body.active).toEqual([]);
    t.setNow('2026-11-03T18:00:00Z');
    await B.post(`/api/groups/${s.id}/focus/start`);
    f = await A.get(`/api/groups/${s.id}/focus`);
    expect(f.body.groupStreak).toBe(2);
    expect(f.body.myStreak).toBe(1);
  });

  it('exam countdown', async () => {
    await A.post(`/api/groups/${s.id}/countdowns`, { title: 'Finals', at: '2026-11-26T09:00:00+02:00' });
    const list = await B.get(`/api/groups/${s.id}/countdowns`);
    expect(list.body[0].title).toBe('Finals');
  });

  it('flashcards: per-member spaced repetition', async () => {
    t.setNow('2026-11-02T10:00:00Z');
    const deck = await A.post(`/api/groups/${s.id}/decks`, { title: 'Linear algebra' });
    const c1 = await A.post(`/api/groups/${s.id}/decks/${deck.body.id}/cards`, { front: 'det(I)?', back: '1' });
    await A.post(`/api/groups/${s.id}/decks/${deck.body.id}/cards`, { front: 'rank of 0 matrix?', back: '0' });
    expect((await B.get(`/api/groups/${s.id}/decks/${deck.body.id}/study`)).body).toHaveLength(2);
    const rv = await A.post(`/api/groups/${s.id}/cards/${c1.body.id}/review`, { grade: 4 });
    expect(rv.body).toMatchObject({ interval: 1, reps: 1 });
    expect((await A.get(`/api/groups/${s.id}/decks/${deck.body.id}/study`)).body.map((x: any) => x.front)).toEqual(['rank of 0 matrix?']);
    // Bilal's schedule is his own
    expect((await B.get(`/api/groups/${s.id}/decks/${deck.body.id}/study`)).body).toHaveLength(2);
    t.setNow('2026-11-03T10:00:01Z');
    expect((await A.get(`/api/groups/${s.id}/decks/${deck.body.id}/study`)).body).toHaveLength(2);
    const second = await A.post(`/api/groups/${s.id}/cards/${c1.body.id}/review`, { grade: 4 });
    expect(second.body.interval).toBe(6);
    const decks = await A.get(`/api/groups/${s.id}/decks`);
    expect(decks.body[0]).toMatchObject({ cards: 2, due: 1 });
  });

  it('wiki pages', async () => {
    const p = await A.post(`/api/groups/${s.id}/pages`, { title: 'Exam tips', body: '- sleep\n- water' });
    await B.patch(`/api/groups/${s.id}/pages/${p.body.id}`, { title: 'Exam tips', body: '- sleep\n- water\n- past papers' });
    expect((await A.get(`/api/groups/${s.id}/pages/${p.body.id}`)).body).toMatchObject({ updatedBy: B.user.id });
    expect((await B.del(`/api/groups/${s.id}/pages/${p.body.id}`)).status).toBe(403);
    expect((await A.del(`/api/groups/${s.id}/pages/${p.body.id}`)).status).toBe(200);
  });

  it('cross-group: decks, cards, pages, carpool, votes of another group → 404', async () => {
    const deck = await A.post(`/api/groups/${s.id}/decks`, { title: 'D' });
    const card = await A.post(`/api/groups/${s.id}/decks/${deck.body.id}/cards`, { front: 'f', back: 'b' });
    const page = await A.post(`/api/groups/${s.id}/pages`, { title: 'P' });
    const mine = await makeGroup(cap, 'study', 'Cap study');
    expect((await cap.get(`/api/groups/${mine.id}/decks/${deck.body.id}`)).status).toBe(404);
    expect((await cap.post(`/api/groups/${mine.id}/cards/${card.body.id}/review`, { grade: 5 })).status).toBe(404);
    expect((await cap.get(`/api/groups/${mine.id}/pages/${page.body.id}`)).status).toBe(404);
    expect((await cap.patch(`/api/groups/${mine.id}/pages/${page.body.id}`, { title: 'x' })).status).toBe(404);
    const myTeam = await makeGroup(A, 'sport', 'A team');
    const ev = (await cap.get(`/api/groups/${g.id}/events`)).body[0].id;
    expect((await A.get(`/api/groups/${myTeam.id}/events/${ev}/motm`)).status).toBe(404);
    expect((await A.post(`/api/groups/${myTeam.id}/events/${ev}/carpool`, { seats: 2 })).status).toBe(404);
  });
});
