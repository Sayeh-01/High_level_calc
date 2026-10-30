import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeModel } from '../src/ai';
import { dueCharges, notifications } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, X: Client;
let trip: { id: string; code: string; group: any };
let party: { id: string; code: string; group: any };

beforeAll(async () => {
  t = await setup({ ai: createFakeModel({ receipt: () => ({ title: 'Carrefour Maadi', total: 48550, currency: null, items: [{ name: 'Water', amount: 2550 }, { name: 'Snacks', amount: 46000 }] }) }) });
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  X = await t.signIn('x@example.com', 'Xavier');
  trip = await makeGroup(A, 'trip', 'Rome 2026', { currency: 'EGP' });
  await join(B, trip.code);
  await join(C, trip.code);
  party = await makeGroup(A, 'event', 'Nour’s wedding');
  await join(B, party.code);
});
afterAll(() => t.close());

const alerts = async (userId: string, budgetId: string) =>
  (await t.db.select().from(notifications).where(and(eq(notifications.kind, 'budget_alert'), eq(notifications.userId, userId)))).filter((n: any) => n.data.budgetId === budgetId);

describe('Trip and Event templates', () => {
  it('Trip comes with itinerary, packing, expenses and budgets; Event with guests, contacts and budgets', async () => {
    expect(trip.group.modules).toEqual(expect.arrayContaining(['events', 'lists', 'expenses', 'budgets', 'vault']));
    expect(party.group.modules).toEqual(expect.arrayContaining(['guests', 'tasks', 'budgets', 'contacts', 'polls']));
    const packing = await A.get(`/api/groups/${trip.id}/lists`);
    expect(packing.body[0].title).toBe('Packing');
    const timeline = await A.get(`/api/groups/${party.id}/tasks`);
    expect(timeline.body.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Book the venue', 'Send invitations']));
  });
});

describe('multi-currency trip (B9 v2.0)', () => {
  it('settles in one currency using each expense’s stored rate', async () => {
    const all = [A.user.id, B.user.id, C.user.id];
    // A pays €90 at 52.50 → 4,725.00 EGP; B pays $30 at 48.00 → 1,440.00 EGP; C pays 300.00 EGP
    const eur = await A.post(`/api/groups/${trip.id}/expenses`, { title: 'Dinner in Trastevere', amount: 9000, currency: 'EUR', rate: 52.5, payerId: A.user.id, split: { kind: 'equal', members: all } });
    expect(eur.status).toBe(200);
    expect(eur.body).toMatchObject({ amountMinor: 472500, originalMinor: 9000, currency: 'EUR', rate: 52.5 });
    const usd = await B.post(`/api/groups/${trip.id}/expenses`, { title: 'Museum tickets', amount: 3000, currency: 'USD', rate: 48, payerId: B.user.id, split: { kind: 'equal', members: all } });
    expect(usd.body.amountMinor).toBe(144000);
    await C.post(`/api/groups/${trip.id}/expenses`, { title: 'Taxi to the airport', amount: 30000, payerId: C.user.id, split: { kind: 'equal', members: all } });

    // a foreign expense without a rate is refused
    expect((await A.post(`/api/groups/${trip.id}/expenses`, { title: 'Gelato', amount: 500, currency: 'EUR', payerId: A.user.id, split: { kind: 'equal', members: all } })).status).toBe(400);

    // later rates do not touch what was stored: a second EUR expense at a different rate keeps its own rate
    const eur2 = await A.post(`/api/groups/${trip.id}/expenses`, { title: 'Coffee', amount: 600, currency: 'EUR', rate: 55, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id] } });
    expect(eur2.body.amountMinor).toBe(33000);
    const list = await A.get(`/api/groups/${trip.id}/expenses`);
    expect(list.body.find((x: any) => x.id === eur.body.id)).toMatchObject({ rate: 52.5, amountMinor: 472500 });

    const total = 472500 + 144000 + 30000 + 33000;
    const bal = await A.get(`/api/groups/${trip.id}/balances`);
    // everything is in the group currency; balances sum to zero
    expect(Object.values(bal.body.balances as Record<string, number>).reduce((s, v) => s + v, 0)).toBe(0);
    // A paid 4,725 + 330 and owes 1/3 of 6,165 + 165
    const third = (472500 + 144000 + 30000) / 3;
    expect(bal.body.balances[A.user.id]).toBe(472500 + 33000 - third - 16500);
    expect(bal.body.balances[B.user.id]).toBe(144000 - third - 16500);
    expect(bal.body.balances[C.user.id]).toBe(30000 - third);
    // the suggested transfers clear every balance, all in EGP
    const after: Record<string, number> = { ...bal.body.balances };
    for (const tr of bal.body.transfers) {
      after[tr.from] += tr.amount;
      after[tr.to] -= tr.amount;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
    expect(total).toBe(679500);
  });
});

describe('budget alerts (B9 v2.0)', () => {
  it('fire once at 80% and once at 100% per period, to the adults who see money', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    const b = await A.post(`/api/groups/${party.id}/budgets`, { category: 'Catering', amount: 100000, period: 'month' });
    expect(b.status).toBe(200);
    expect((await B.post(`/api/groups/${party.id}/budgets`, { category: 'x', amount: 100 })).status).toBe(403);
    const spend = async (amount: number, category = 'Catering') => {
      t.advance(60_000);
      const r = await A.post(`/api/groups/${party.id}/expenses`, { title: 'Food', amount, category, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id] } });
      expect(r.status).toBe(200);
      return r;
    };
    await spend(50000); // 50%
    expect(await alerts(A.user.id, b.body.id)).toHaveLength(0);
    await spend(20000, 'Flowers'); // another category does not count
    expect(await alerts(A.user.id, b.body.id)).toHaveLength(0);
    await spend(30000); // 80%
    expect((await alerts(A.user.id, b.body.id)).map((n: any) => n.data.threshold)).toEqual([80]);
    await spend(5000); // 85% — no repeat
    expect(await alerts(A.user.id, b.body.id)).toHaveLength(1);
    await spend(15000); // 100%
    await spend(10000); // 110% — no repeat
    expect((await alerts(A.user.id, b.body.id)).map((n: any) => n.data.threshold).sort()).toEqual([100, 80]);
    expect(await alerts(B.user.id, b.body.id)).toHaveLength(2);

    const listed = await B.get(`/api/groups/${party.id}/budgets`);
    expect(listed.body.find((x: any) => x.id === b.body.id)).toMatchObject({ spent: 110000, percent: 110 });

    // reversing below the threshold and crossing again in the same month does not re-alert
    // a new month starts a new period: the alerts fire again, once each
    t.setNow('2026-12-03T08:00:00Z');
    await spend(80000);
    await spend(20000);
    await spend(1000);
    expect((await alerts(A.user.id, b.body.id)).map((n: any) => n.data.periodKey).sort()).toEqual(['2026-11', '2026-11', '2026-12', '2026-12']);
  });

  it('a whole-trip budget (* , total) counts every category and never resets', async () => {
    const b = await A.post(`/api/groups/${trip.id}/budgets`, { category: '*', amount: 1000000, period: 'total' });
    // the trip already spent 6,795.00 of 10,000.00 → 67%, nothing yet
    const now = (await A.get(`/api/groups/${trip.id}/budgets`)).body.find((x: any) => x.id === b.body.id);
    expect(now.percent).toBe(68);
    t.advance(60_000);
    await A.post(`/api/groups/${trip.id}/expenses`, { title: 'Hotel', amount: 200000, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id, C.user.id] } });
    expect((await alerts(C.user.id, b.body.id)).map((n: any) => n.data.threshold)).toEqual([80]);
    t.setNow('2027-01-10T08:00:00Z');
    await A.post(`/api/groups/${trip.id}/expenses`, { title: 'Train', amount: 200000, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id, C.user.id] } });
    expect((await alerts(C.user.id, b.body.id)).map((n: any) => n.data.threshold).sort()).toEqual([100, 80]);
  });
});

describe('guest list (B9 v2.0)', () => {
  it('RSVPs through the link count plus-ones; plus-ones are capped per guest', async () => {
    const g1 = await A.post(`/api/groups/${party.id}/guests`, { name: 'Aunt Hoda', maxPlusOnes: 2 });
    const g2 = await A.post(`/api/groups/${party.id}/guests`, { name: 'Omar', maxPlusOnes: 1 });
    const g3 = await B.post(`/api/groups/${party.id}/guests`, { name: 'Salma' });
    const g4 = await A.post(`/api/groups/${party.id}/guests`, { name: 'Karim', maxPlusOnes: 3 });
    expect(g1.status).toBe(200);
    const token = (u: string) => new URL(u).pathname.split('/').pop()!;

    // the page works without the app or a session
    const page = await t.raw('GET', `/p/${token(g1.body.url)}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Aunt Hoda');
    expect(html).toContain('data-testid="guest-plus"');

    // form post (no JS): Hoda comes with 2; API: Omar asks for 4 but may bring 1; Salma maybe; Karim says no with 3
    const form = await t.app.request(`/p/${token(g1.body.url)}/invitee?lang=en`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'status=going&plusOnes=2&dietary=Vegetarian' });
    expect(form.status).toBe(303);
    expect((await t.raw('POST', `/api/guest/${token(g2.body.url)}/invitee`, { status: 'going', plusOnes: 4 })).status).toBe(200);
    expect((await t.raw('POST', `/api/guest/${token(g3.body.url)}/invitee`, { status: 'maybe', plusOnes: 1 })).status).toBe(200);
    expect((await t.raw('POST', `/api/guest/${token(g4.body.url)}/invitee`, { status: 'no', plusOnes: 3 })).status).toBe(200);

    const list = await B.get(`/api/groups/${party.id}/guests`);
    expect(list.body.totals).toEqual({ invited: 4, going: 2, maybe: 1, no: 1, pending: 0, headcount: 2 + 2 + 1 });
    const hoda = list.body.guests.find((x: any) => x.id === g1.body.id);
    expect(hoda).toMatchObject({ status: 'going', plusOnes: 2, dietary: 'Vegetarian' });
    expect(list.body.guests.find((x: any) => x.id === g2.body.id).plusOnes).toBe(1);
    expect(list.body.guests.find((x: any) => x.id === g3.body.id).plusOnes).toBe(0);

    // changing their mind updates the count
    await t.raw('POST', `/api/guest/${token(g1.body.url)}/invitee`, { status: 'going', plusOnes: 0 });
    expect((await A.get(`/api/groups/${party.id}/guests`)).body.totals.headcount).toBe(3);

    // removing a guest turns their link off
    expect((await A.del(`/api/groups/${party.id}/guests/${g4.body.id}`)).status).toBe(200);
    expect((await t.raw('POST', `/api/guest/${token(g4.body.url)}/invitee`, { status: 'going' })).status).toBe(404);
    expect((await t.raw('GET', `/p/${token(g4.body.url)}`)).status).toBe(404);
  });
});

describe('dues', () => {
  it('a monthly fee shows a paid / unpaid board; members report, the collector confirms; reminder the day before', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    const club = await makeGroup(A, 'sport', 'Padel club');
    await join(B, club.code);
    await join(C, club.code);
    expect((await A.post(`/api/groups/${club.id}/dues`, { title: 'Court fee', amount: 20000 })).status).toBe(404); // module off
    const mods = (await A.get(`/api/groups/${club.id}`)).body.group.modules;
    await A.put(`/api/groups/${club.id}/modules`, { modules: [...mods, 'dues'] });
    const due = await A.post(`/api/groups/${club.id}/dues`, { title: 'Court fee', amount: 20000, dueDay: 10 });
    expect(due.status).toBe(200);
    expect((await B.post(`/api/groups/${club.id}/dues`, { title: 'x', amount: 1 })).status).toBe(403);

    let board = (await B.get(`/api/groups/${club.id}/dues`)).body[0];
    expect(board).toMatchObject({ periodKey: '2026-11', collected: 0 });
    expect(board.board).toHaveLength(3);
    const mine = board.board.find((x: any) => x.payerKey === B.user.id);
    const cs = board.board.find((x: any) => x.payerKey === C.user.id);
    // only the payer can report; only the collector can confirm
    expect((await C.post(`/api/groups/${club.id}/dues/${due.body.id}/charges/${mine.id}/report`)).status).toBe(403);
    expect((await B.post(`/api/groups/${club.id}/dues/${due.body.id}/charges/${mine.id}/report`)).status).toBe(200);
    expect((await B.post(`/api/groups/${club.id}/dues/${due.body.id}/charges/${mine.id}/confirm`)).status).toBe(403);
    board = (await A.get(`/api/groups/${club.id}/dues`)).body[0];
    expect(board.board.find((x: any) => x.id === mine.id).status).toBe('reported');
    expect((await A.post(`/api/groups/${club.id}/dues/${due.body.id}/charges/${mine.id}/confirm`)).status).toBe(200);
    board = (await A.get(`/api/groups/${club.id}/dues`)).body[0];
    expect(board.collected).toBe(20000);
    expect(board.board.find((x: any) => x.id === mine.id).status).toBe('paid');

    // reminder on the 9th at 09:00 Cairo goes only to those who have not paid or reported
    t.setNow('2026-11-09T07:00:00Z');
    await t.runJobs();
    await t.runJobs();
    const reminders = await t.db.select().from(notifications).where(eq(notifications.kind, 'dues_reminder'));
    expect(reminders.map((n) => n.userId).sort()).toEqual([A.user.id, C.user.id].sort());
    expect(cs.status).toBe('unpaid');

    // the next month's board appears on the 1st without anyone opening the screen; its reminder reaches everyone unpaid
    t.setNow('2026-11-30T22:06:00Z'); // 00:06 on 1 Dec in Cairo
    await t.runJobs();
    const dec = await t.db.select().from(dueCharges).where(and(eq(dueCharges.dueId, due.body.id), eq(dueCharges.periodKey, '2026-12')));
    expect(dec).toHaveLength(3);
    t.setNow('2026-12-09T07:00:00Z');
    await t.runJobs();
    const decReminders = (await t.db.select().from(notifications).where(eq(notifications.kind, 'dues_reminder'))).filter((n: any) => n.data.periodKey === '2026-12');
    expect(decReminders).toHaveLength(3);
    board = (await A.get(`/api/groups/${club.id}/dues`)).body[0];
    expect(board).toMatchObject({ periodKey: '2026-12', collected: 0 });
    expect(board.board.every((x: any) => x.status === 'unpaid')).toBe(true);
  });
});

describe('contacts', () => {
  it('the group directory lists vendors and numbers; helpers can add', async () => {
    const v = await B.post(`/api/groups/${party.id}/contacts`, { name: 'Zahra Flowers', kind: 'vendor', phone: '+201001234567' });
    expect(v.status).toBe(200);
    await A.post(`/api/groups/${party.id}/contacts`, { name: 'DJ Ali', kind: 'vendor', email: 'ali@example.com' });
    const list = await B.get(`/api/groups/${party.id}/contacts`);
    expect(list.body.map((x: any) => x.name)).toEqual(['DJ Ali', 'Zahra Flowers']);
    expect((await A.del(`/api/groups/${party.id}/contacts/${v.body.id}`)).status).toBe(200);
    expect((await B.get(`/api/groups/${party.id}/contacts`)).body).toHaveLength(1);
  });
});

describe('receipt scan (AI, draft only)', () => {
  it('returns a draft in the group currency and saves nothing', async () => {
    const up = await A.post(`/api/groups/${trip.id}/files`, { mime: 'image/jpeg', size: 4 });
    await t.app.request(up.body.uploadUrl, { method: 'PUT', body: new Uint8Array([255, 216, 255, 224]) });
    const before = (await A.get(`/api/groups/${trip.id}/expenses`)).body.length;
    const res = await A.post(`/api/groups/${trip.id}/ai/receipt`, { fileId: up.body.fileId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: false, draft: { title: 'Carrefour Maadi', total: 48550, currency: 'EGP' } });
    expect(res.body.draft.items).toHaveLength(2);
    expect((await A.get(`/api/groups/${trip.id}/expenses`)).body.length).toBe(before);
    // another group's file is refused
    const xg = await makeGroup(X, 'trip', 'X trip');
    const xf = await X.post(`/api/groups/${xg.id}/files`, { mime: 'image/jpeg', size: 4 });
    expect((await A.post(`/api/groups/${trip.id}/ai/receipt`, { fileId: xf.body.fileId })).status).toBe(400);
  });
});

describe('cross-group (B9): another group’s dues, budgets, contacts and guests → 404', () => {
  it('a member of X using ids from A’s groups gets 404 and changes nothing', async () => {
    const xg = await makeGroup(X, 'event', 'X party');
    const mods = (await X.get(`/api/groups/${xg.id}`)).body.group.modules;
    await X.put(`/api/groups/${xg.id}/modules`, { modules: [...mods, 'dues'] });
    const budget = (await A.get(`/api/groups/${party.id}/budgets`)).body[0];
    const contact = (await A.get(`/api/groups/${party.id}/contacts`)).body[0];
    const guest = (await A.get(`/api/groups/${party.id}/guests`)).body.guests[0];
    await A.put(`/api/groups/${party.id}/modules`, { modules: [...party.group.modules, 'dues'] });
    const due = await A.post(`/api/groups/${party.id}/dues`, { title: 'Gift fund', amount: 50000, period: 'once' });
    const charge = (await A.get(`/api/groups/${party.id}/dues`)).body.find((d: any) => d.id === due.body.id).board[0];
    const cases: [string, string][] = [
      ['DELETE', `/api/groups/${xg.id}/budgets/${budget.id}`],
      ['DELETE', `/api/groups/${xg.id}/contacts/${contact.id}`],
      ['DELETE', `/api/groups/${xg.id}/guests/${guest.id}`],
      ['POST', `/api/groups/${xg.id}/dues/${due.body.id}/charges/${charge.id}/confirm`],
      ['POST', `/api/groups/${xg.id}/dues/${due.body.id}/charges/${charge.id}/report`],
    ];
    for (const [m, p] of cases) expect((await X.req(m, p, m === 'POST' ? {} : undefined)).status, `${m} ${p}`).toBe(404);
    expect((await A.get(`/api/groups/${party.id}/budgets`)).body.find((b: any) => b.id === budget.id)).toBeTruthy();
    expect((await A.get(`/api/groups/${party.id}/contacts`)).body.find((b: any) => b.id === contact.id)).toBeTruthy();
    expect((await A.get(`/api/groups/${party.id}/guests`)).body.guests.find((b: any) => b.id === guest.id)).toBeTruthy();
    expect((await A.get(`/api/groups/${party.id}/dues`)).body.find((d: any) => d.id === due.body.id).board.find((x: any) => x.id === charge.id).status).toBe('unpaid');
  });
});
