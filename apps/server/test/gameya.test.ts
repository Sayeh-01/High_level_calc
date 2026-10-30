import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gameyaSlots, notifications } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, D: Client, X: Client;
let g: { id: string; code: string; group: any };
let gid: string;
const AMOUNT = 200000;
const url = (p = '') => `/api/groups/${g.id}/gameyas/${gid}${p}`;

beforeAll(async () => {
  t = await setup();
  t.setNow('2026-11-02T08:00:00Z');
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  D = await t.signIn('d@example.com', 'Dina');
  X = await t.signIn('x@example.com', 'Xavier');
  g = await makeGroup(A, 'savings', 'Office gam’eya');
  for (const u of [B, C, D]) await join(u, g.code);
});
afterAll(() => t.close());

const board = async (who: Client = A) => (await who.get(url())).body;
const payment = (b: any, position: number, payer: Client) => b.months[position - 1].payments.find((p: any) => p.payerId === payer.user.id);

/** every non-receiver reports, the receiver confirms each share */
async function payMonth(position: number) {
  const b = await board();
  const receiver = [A, B, C, D].find((u) => u.user.id === b.months[position - 1].receiverId)!;
  for (const u of [A, B, C, D]) {
    const p = payment(b, position, u);
    if (p.confirmedAt) continue;
    if (!p.reportedAt) expect((await u.post(url(`/payments/${p.id}/report`))).status).toBe(200);
    expect((await receiver.post(url(`/payments/${p.id}/confirm`))).status).toBe(200);
  }
}

describe('Savings Circle template', () => {
  it('comes with the gam’eya module and Organizer / Member roles', async () => {
    expect(g.group.modules).toEqual(expect.arrayContaining(['gameya', 'chat']));
    expect((await A.get(`/api/groups/${g.id}`)).body.me.role).toBe('owner');
  });
});

describe('starting a round', () => {
  it('only an organizer starts it; members must be adults of the group; not in the past', async () => {
    const body = { title: 'Office gam’eya', amount: AMOUNT, startMonth: '2026-11', dueDay: 10, orderMode: 'agreed', memberIds: [A.user.id, B.user.id, C.user.id, D.user.id] };
    expect((await B.post(`/api/groups/${g.id}/gameyas`, body)).status).toBe(403);
    expect((await A.post(`/api/groups/${g.id}/gameyas`, { ...body, memberIds: [A.user.id, X.user.id] })).status).toBe(400);
    expect((await A.post(`/api/groups/${g.id}/gameyas`, { ...body, memberIds: [A.user.id, B.user.id, A.user.id] })).status).toBe(400);
    expect((await A.post(`/api/groups/${g.id}/gameyas`, { ...body, startMonth: '2026-10' })).status).toBe(400);
    const res = await A.post(`/api/groups/${g.id}/gameyas`, body);
    expect(res.status).toBe(200);
    gid = res.body.id;
    expect(res.body.order).toEqual(body.memberIds);
    const b = await board(B);
    expect(b.pot).toBe(AMOUNT * 4);
    expect(b.months.map((m: any) => m.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    // the receiver's own share is confirmed at once (it never leaves their hands)
    expect(payment(b, 1, A).confirmedAt).not.toBeNull();
    expect(payment(b, 1, B).confirmedAt).toBeNull();
    // everyone was told their turn
    const turn = await t.db.select().from(notifications).where(and(eq(notifications.kind, 'gameya_turn'), eq(notifications.userId, C.user.id)));
    expect(turn[0].body).toContain('month 3');
  });

  it('a drawn order is a permutation of the chosen members', async () => {
    const other = await makeGroup(A, 'savings', 'Drawn circle');
    await join(B, other.code);
    await join(C, other.code);
    const res = await A.post(`/api/groups/${other.id}/gameyas`, { title: 'Drawn', amount: 1000, startMonth: '2026-12', orderMode: 'drawn', memberIds: [A.user.id, B.user.id, C.user.id] });
    expect(res.status).toBe(200);
    expect([...res.body.order].sort()).toEqual([A.user.id, B.user.id, C.user.id].sort());
  });
});

describe('swaps (B9 v2.2): need both members plus the organizer', () => {
  it('B ↔ D: a bystander can’t accept, a member can’t approve; only both + organizer swap the turns', async () => {
    const s = await B.post(url('/swaps'), { otherId: D.user.id });
    expect(s.status).toBe(200);
    expect((await B.post(url('/swaps'), { otherId: C.user.id })).status).toBe(409); // one open request at a time
    expect((await C.post(url(`/swaps/${s.body.id}/accept`))).status).toBe(403);
    expect((await B.post(url(`/swaps/${s.body.id}/approve`))).status).toBe(403);
    expect((await D.post(url(`/swaps/${s.body.id}/accept`))).body.status).toBe('pending'); // other member alone: not yet
    expect((await board()).months[1].receiverId).toBe(B.user.id);
    const done = await A.post(url(`/swaps/${s.body.id}/approve`));
    expect(done.body.status).toBe('done');
    const b = await board();
    expect(b.months.map((m: any) => m.receiverId)).toEqual([A.user.id, D.user.id, C.user.id, B.user.id]);
    // the auto-confirmed own share moved with the turn
    expect(payment(b, 2, D).confirmedAt).not.toBeNull();
    expect(payment(b, 2, B).confirmedAt).toBeNull();
    expect(payment(b, 4, B).confirmedAt).not.toBeNull();
    expect((await D.post(url(`/swaps/${s.body.id}/accept`))).status).toBe(409);
  });

  it('organizer approval alone is not enough either, and a rejected swap changes nothing', async () => {
    const s = await C.post(url('/swaps'), { otherId: B.user.id });
    expect((await A.post(url(`/swaps/${s.body.id}/approve`))).body.status).toBe('pending');
    expect((await B.post(url(`/swaps/${s.body.id}/reject`))).body.status).toBe('rejected');
    expect((await board()).months.map((m: any) => m.receiverId)).toEqual([A.user.id, D.user.id, C.user.id, B.user.id]);
  });

  it('a turn that has started can’t be swapped', async () => {
    expect((await C.post(url('/swaps'), { otherId: A.user.id })).status).toBe(409);
    expect((await C.post(url('/swaps'), { otherId: X.user.id })).status).toBe(400);
  });

  it('the database itself refuses a second slot for the same member', async () => {
    await expect(t.db.insert(gameyaSlots).values({ gameyaId: gid, groupId: g.id, position: 9, userId: A.user.id })).rejects.toThrow();
  });
});

describe('a full round (B9 v2.2)', () => {
  it('only the month’s receiver confirms; reminders go to the unpaid; Today shows the month, the due and my turn', async () => {
    // month 1: receiver A
    const b1 = await board();
    expect((await B.post(url(`/payments/${payment(b1, 1, C).id}/report`))).status).toBe(403);
    await C.post(url(`/payments/${payment(b1, 1, C).id}/report`));
    expect((await D.post(url(`/payments/${payment(b1, 1, C).id}/confirm`))).status).toBe(403);
    await payMonth(1);
    expect((await board()).months[0].receivedAt).not.toBeNull();

    // month 2 (receiver D): reminder on 9 Dec at 09:00 Cairo to whoever hasn't paid or reported
    t.setNow('2026-12-02T08:00:00Z');
    const today = (await B.get('/api/me/today')).body.gameya.filter((x: any) => x.gameyaId === gid);
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ title: 'Office gam’eya', month: 2, months: 4, myTurn: 4, myTurnMonth: '2027-02', pot: AMOUNT * 4, due: { amount: AMOUNT, late: false } });
    const b2 = await board();
    await A.post(url(`/payments/${payment(b2, 2, A).id}/report`));
    t.setNow('2026-12-09T07:00:00Z');
    await t.runJobs();
    await t.runJobs();
    const due = await t.db.select().from(notifications).where(eq(notifications.kind, 'gameya_due'));
    expect(due.filter((n: any) => n.data.position === 2).map((n) => n.userId).sort()).toEqual([B.user.id, C.user.id].sort());
    await C.post(url(`/payments/${payment(b2, 2, C).id}/report`)); // C pays on time after the reminder
    // B pays late (after the 10th)
    t.setNow('2026-12-12T10:00:00Z');
    expect(payment(await board(), 2, B).status).toBe('late');
    await payMonth(2);

    t.setNow('2027-01-05T10:00:00Z');
    await payMonth(3);
    t.setNow('2027-02-05T10:00:00Z');
    await payMonth(4);
  });

  it('each member received the pot exactly once; paid in = paid out every month; everyone ends even', async () => {
    const b = await board();
    expect(b.gameya.status).toBe('done');
    const receivers = b.months.map((m: any) => m.receiverId);
    expect(new Set(receivers).size).toBe(4);
    expect([...receivers].sort()).toEqual([A, B, C, D].map((u) => u.user.id).sort());
    for (const m of b.months) {
      expect(m.receivedAt, `month ${m.position}`).not.toBeNull();
      expect(m.paidIn).toBe(AMOUNT * 4);
      expect(m.paidOut).toBe(m.paidIn);
      expect(m.expected).toBe(m.paidIn);
    }
    for (const u of [A, B, C, D]) {
      const paid = b.months.flatMap((m: any) => m.payments).filter((p: any) => p.payerId === u.user.id && p.confirmedAt).reduce((s: number, p: any) => s + p.amountMinor, 0);
      const received = b.months.filter((m: any) => m.receiverId === u.user.id).reduce((s: number, m: any) => s + m.paidOut, 0);
      expect(received - paid, u.user.name).toBe(0);
    }
    // nothing to pay any more
    expect((await B.get('/api/me/today')).body.gameya.filter((x: any) => x.gameyaId === gid)).toEqual([]);
  });

  it('the history is a trust record: B was late once, the others never', async () => {
    const { trust } = await board();
    const of = (u: Client) => trust.find((x: any) => x.userId === u.user.id);
    // three shares each (their own month's share isn't a payment)
    expect(of(B)).toMatchObject({ due: 3, onTime: 2, late: 1, open: 0 });
    expect(of(C)).toMatchObject({ due: 3, onTime: 3, late: 0 });
  });

  it('the organizer can run the next round with the same members', async () => {
    expect((await B.post(url('/next-round'))).status).toBe(403);
    const next = await A.post(url('/next-round'));
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ round: 2, previousId: gid, startMonth: '2027-03' });
    expect(next.body.order).toEqual([A.user.id, D.user.id, C.user.id, B.user.id]);
  });
});

describe('cross-group (B9): another group’s round, payments and swaps → 404', () => {
  it('a member of X’s group using A’s ids gets 404 and nothing changes', async () => {
    const xg = await makeGroup(X, 'savings', 'X circle');
    const b = await board();
    const p = b.months[0].payments[1];
    const swap = b.swaps[0];
    const cases: [string, string][] = [
      ['GET', `/api/groups/${xg.id}/gameyas/${gid}`],
      ['POST', `/api/groups/${xg.id}/gameyas/${gid}/payments/${p.id}/report`],
      ['POST', `/api/groups/${xg.id}/gameyas/${gid}/payments/${p.id}/confirm`],
      ['POST', `/api/groups/${xg.id}/gameyas/${gid}/swaps/${swap.id}/approve`],
      ['POST', `/api/groups/${xg.id}/gameyas/${gid}/next-round`],
    ];
    for (const [m, path] of cases) expect((await X.req(m, path, m === 'POST' ? {} : undefined)).status, `${m} ${path}`).toBe(404);
    expect((await X.get(`/api/groups/${xg.id}/gameyas`)).body).toEqual([]);
  });
});
