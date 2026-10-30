import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client;
let gid: string;

beforeAll(async () => {
  t = await setup();
  A = await t.signIn('a@example.com', 'A');
  B = await t.signIn('b@example.com', 'B');
  C = await t.signIn('c@example.com', 'C');
  const g = await makeGroup(A, 'roommates', 'Flat');
  gid = g.id;
  await join(B, g.code);
  await join(C, g.code);
});
afterAll(() => t.close());

describe('expenses over the API', () => {
  it('A pays 300 split equally → B and C each owe A 100; only a confirmed settlement counts', async () => {
    const e = await A.post(`/api/groups/${gid}/expenses`, { title: 'Groceries', amount: 30000, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id, C.user.id] } });
    expect(e.status).toBe(200);
    expect(e.body.shares.map((s: any) => s.amountMinor).reduce((a: number, b: number) => a + b, 0)).toBe(30000);
    let bal = await B.get(`/api/groups/${gid}/balances`);
    expect(bal.body.balances).toEqual({ [A.user.id]: 20000, [B.user.id]: -10000, [C.user.id]: -10000 });

    const s = await B.post(`/api/groups/${gid}/settlements`, { toId: A.user.id, amount: 10000, method: 'cash' });
    bal = await B.get(`/api/groups/${gid}/balances`);
    expect(bal.body.balances[B.user.id]).toBe(-10000);
    expect(bal.body.pending).toHaveLength(1);

    // only the receiver can confirm
    expect((await C.post(`/api/groups/${gid}/settlements/${s.body.id}/confirm`)).status).toBe(403);
    expect((await B.post(`/api/groups/${gid}/settlements/${s.body.id}/confirm`)).status).toBe(403);
    expect((await A.post(`/api/groups/${gid}/settlements/${s.body.id}/confirm`)).status).toBe(200);
    bal = await B.get(`/api/groups/${gid}/balances`);
    expect(bal.body.balances[B.user.id]).toBe(0);
    expect(bal.body.transfers).toEqual([{ from: C.user.id, to: A.user.id, amount: 10000 }]);
  });

  it('a rejected settlement never counts', async () => {
    const s = await C.post(`/api/groups/${gid}/settlements`, { toId: A.user.id, amount: 10000, method: 'wallet' });
    await A.post(`/api/groups/${gid}/settlements/${s.body.id}/reject`);
    const bal = await C.get(`/api/groups/${gid}/balances`);
    expect(bal.body.balances[C.user.id]).toBe(-10000);
  });

  it('exact and shares splits; exact must add up', async () => {
    const bad = await A.post(`/api/groups/${gid}/expenses`, { title: 'x', amount: 1000, payerId: A.user.id, split: { kind: 'exact', amounts: { [A.user.id]: 500, [B.user.id]: 400 } } });
    expect(bad.status).toBe(400);
    const rent = await A.post(`/api/groups/${gid}/expenses`, { title: 'Rent', amount: 1000001, payerId: A.user.id, split: { kind: 'shares', shares: { [A.user.id]: 2, [B.user.id]: 1, [C.user.id]: 1 } } });
    expect(rent.body.shares.reduce((s: number, x: any) => s + x.amountMinor, 0)).toBe(1000001);
  });

  it('reversal removes an expense from balances without deleting it', async () => {
    const before = (await A.get(`/api/groups/${gid}/balances`)).body.balances;
    const e = await B.post(`/api/groups/${gid}/expenses`, { title: 'Pizza', amount: 999, payerId: B.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id, C.user.id] } });
    expect((await C.post(`/api/groups/${gid}/expenses/${e.body.id}/reverse`)).status).toBe(403);
    expect((await B.post(`/api/groups/${gid}/expenses/${e.body.id}/reverse`)).status).toBe(200);
    expect((await A.get(`/api/groups/${gid}/balances`)).body.balances).toEqual(before);
    const list = await A.get(`/api/groups/${gid}/expenses`);
    expect(list.body.find((x: any) => x.id === e.body.id).reversedAt).not.toBeNull();
  });

  it('non-members cannot be payer or in a split', async () => {
    const outsider = await t.signIn('o@example.com');
    const res = await A.post(`/api/groups/${gid}/expenses`, { title: 'x', amount: 100, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, outsider.user.id] } });
    expect(res.status).toBe(400);
  });
});

describe('split an event among Going → Today', () => {
  it('A splits a match fee among those going; B’s Today shows what B owes', async () => {
    const g = await makeGroup(A, 'sport', 'Football');
    await join(B, g.code);
    await join(C, g.code);
    t.setNow('2026-11-02T08:00:00Z');
    const ev = await A.post(`/api/groups/${g.id}/events`, { title: 'Match', startsAt: '2026-11-05T21:00:00+02:00' });
    await A.post(`/api/groups/${g.id}/events/${ev.body.id}/rsvp`, { status: 'going' });
    await B.post(`/api/groups/${g.id}/events/${ev.body.id}/rsvp`, { status: 'going' });
    await C.post(`/api/groups/${g.id}/events/${ev.body.id}/rsvp`, { status: 'no' });
    const split = await A.post(`/api/groups/${g.id}/events/${ev.body.id}/split`, { amount: 10000 });
    expect(split.status).toBe(200);
    expect(split.body.perPerson).toEqual({ [A.user.id]: 5000, [B.user.id]: 5000 });
    const today = await B.get('/api/me/today');
    const row = today.body.money.find((m: any) => m.groupId === g.id);
    expect(row).toMatchObject({ net: -5000, currency: 'EGP', groupName: 'Football' });
    expect(row.owe).toEqual([{ to: A.user.id, amount: 5000, name: 'A' }]);
    expect(today.body.events.find((e: any) => e.id === ev.body.id)).toMatchObject({ myStatus: 'going', going: 2 });
    // C did not play and owes nothing in this group
    const todayC = await C.get('/api/me/today');
    expect(todayC.body.money.find((m: any) => m.groupId === g.id)).toBeUndefined();
    // B's expense notification exists
    const inbox = await B.get('/api/me/inbox');
    expect(inbox.body.some((n: any) => n.kind === 'expense')).toBe(true);
  });

  it('Today shows settle-ups waiting for my confirmation', async () => {
    const g = await makeGroup(A, 'roommates', 'Flat 2');
    await join(B, g.code);
    await A.post(`/api/groups/${g.id}/expenses`, { title: 'Internet', amount: 40000, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id] } });
    await B.post(`/api/groups/${g.id}/settlements`, { toId: A.user.id, amount: 20000, method: 'bank' });
    const today = await A.get('/api/me/today');
    expect(today.body.toConfirm.find((s: any) => s.groupId === g.id)).toMatchObject({ amountMinor: 20000, fromName: 'B' });
  });
});
