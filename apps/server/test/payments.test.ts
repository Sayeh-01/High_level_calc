import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeProvider, FAKE_SIGNATURE_HEADER, signWebhook } from '../src/payments/provider';
import { dueCharges, notifications, paymentEvents, payments, receipts, settlements } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client;
let g: { id: string; code: string; group: any };
let secret: string;

beforeAll(async () => {
  t = await setup();
  secret = (t.deps.payments as ReturnType<typeof createFakeProvider>).secret;
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  g = await makeGroup(A, 'roommates', 'Flat 4B');
  await join(B, g.code);
  await join(C, g.code);
  await A.put(`/api/groups/${g.id}/modules`, { modules: [...g.group.modules, 'dues'] });
});
afterAll(() => t.close());

const hook = (body: string, signature: string | null, provider = 'fake') =>
  t.app.request(`/api/webhooks/payments/${provider}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...(signature ? { [FAKE_SIGNATURE_HEADER]: signature } : {}) } });
const event = (p: any, over: Record<string, unknown> = {}) => JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type: 'payment.succeeded', providerRef: p.providerRef, amountMinor: p.totalMinor, currency: p.currency, ...over });
/** B owes A `amount` after this */
async function debt(amount: number) {
  t.advance(60_000);
  await A.post(`/api/groups/${g.id}/expenses`, { title: 'Shared', amount: amount * 2, payerId: A.user.id, split: { kind: 'equal', members: [A.user.id, B.user.id] } });
}
async function pay(checkoutUrl: string) {
  const path = new URL(checkoutUrl).pathname;
  expect((await t.app.request(path)).status).toBe(200);
  return t.app.request(`${path}/pay`, { method: 'POST' });
}

describe('pay a due online through the gateway', () => {
  it('fee on top, the gateway confirms, the due is paid, a receipt is generated (B9 v2.6)', async () => {
    const due = await A.post(`/api/groups/${g.id}/dues`, { title: 'Internet', amount: 20000, dueDay: 10 });
    const mine = (await B.get(`/api/groups/${g.id}/dues`)).body[0].board.find((x: any) => x.payerKey === B.user.id);
    const res = await B.post(`/api/groups/${g.id}/payments`, { purpose: 'due', targetId: mine.id });
    expect(res.status).toBe(200);
    expect(res.body.quote).toEqual({ amount: 20000, fee: 300, total: 20300, payeeReceives: 20000 });
    expect(res.body.payment).toMatchObject({ status: 'created', payeeId: A.user.id, totalMinor: 20300 });
    // nothing is paid until the gateway says so
    expect((await t.db.select().from(dueCharges).where(eq(dueCharges.id, mine.id)))[0].paidAt).toBeNull();

    const back = await pay(res.body.checkoutUrl);
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toContain(`/g/${g.id}/payment/${res.body.payment.id}`);
    const p = await B.get(`/api/groups/${g.id}/payments/${res.body.payment.id}`);
    expect(p.body).toMatchObject({ status: 'succeeded', receipt: { number: expect.stringMatching(/^CIR-2026-\d{6}$/) } });
    const board = (await A.get(`/api/groups/${g.id}/dues`)).body.find((d: any) => d.id === due.body.id).board;
    expect(board.find((x: any) => x.id === mine.id)).toMatchObject({ status: 'paid', confirmedBy: 'gateway' });

    const receipt = await B.get(`/api/groups/${g.id}/payments/${res.body.payment.id}/receipt`);
    expect(receipt.body.number).toBe(p.body.receipt.number);
    for (const s of ['200.00', '3.00', '203.00', 'Bassem', 'Amal', 'Dues', p.body.receipt.number]) expect(receipt.body.html).toContain(s);
    const ar = await A.get(`/api/groups/${g.id}/payments/${res.body.payment.id}/receipt?lang=ar`);
    expect(ar.body.html).toContain('dir="rtl"');
    // the payee was told
    expect((await t.db.select().from(notifications).where(eq(notifications.kind, 'payment_succeeded'))).map((n) => n.userId).sort()).toEqual([A.user.id, B.user.id].sort());
    // paying it again is refused
    expect((await B.post(`/api/groups/${g.id}/payments`, { purpose: 'due', targetId: mine.id })).status).toBe(409);
  });
});

describe('webhooks (B9 v2.6)', () => {
  it('a duplicate webhook produces one payment', async () => {
    await debt(5000);
    const res = await B.post(`/api/groups/${g.id}/payments`, { purpose: 'settlement', targetId: A.user.id, amount: 5000 });
    const p = res.body.payment;
    const body = event(p);
    const sig = signWebhook(secret, body, t.now());
    const first = await hook(body, sig);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ duplicate: false });
    const again = await hook(body, sig);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    // a second, different success event for the same payment changes nothing either
    const other = event(p);
    expect((await hook(other, signWebhook(secret, other, t.now()))).status).toBe(200);
    const made = (await t.db.select().from(settlements)).filter((s) => s.note === `payment ${p.id}`);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ fromId: B.user.id, toId: A.user.id, amountMinor: 5000, method: 'gateway' });
    expect(made[0].confirmedAt).not.toBeNull();
    expect((await t.db.select().from(receipts).where(eq(receipts.paymentId, p.id)))).toHaveLength(1);
    expect((await t.db.select().from(paymentEvents).where(eq(paymentEvents.paymentId, p.id)))).toHaveLength(2);
    // the confirmed gateway settlement cleared B's debt
    expect((await B.get(`/api/groups/${g.id}/balances`)).body.transfers.find((x: any) => x.from === B.user.id)).toBeUndefined();
  });

  it('a bad signature → 400 and nothing saved', async () => {
    await debt(4000);
    const res = await B.post(`/api/groups/${g.id}/payments`, { purpose: 'settlement', targetId: A.user.id, amount: 4000 });
    const p = res.body.payment;
    const eventsBefore = (await t.db.select().from(paymentEvents)).length;
    const body = event(p);
    const tampered = body.replace(String(p.totalMinor), String(p.totalMinor + 1));
    const cases: [string, string | null][] = [
      [tampered, signWebhook(secret, body, t.now())], // body changed after signing
      [body, signWebhook('wrong-secret', body, t.now())],
      [body, null],
      [body, 'garbage'],
      [body, signWebhook(secret, body, new Date(t.now().getTime() - 10 * 60_000))], // replayed 10 minutes later
    ];
    for (const [b, s] of cases) {
      const r = await hook(b, s);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'bad_signature' });
    }
    expect((await t.db.select().from(paymentEvents)).length).toBe(eventsBefore);
    expect((await t.db.select().from(payments).where(eq(payments.id, p.id)))[0].status).toBe('created');
    expect((await t.db.select().from(settlements)).filter((s) => s.note === `payment ${p.id}`)).toHaveLength(0);
    expect((await hook(body, signWebhook(secret, body, t.now()), 'stripe')).status).toBe(404);
  });

  it('an event whose amount doesn’t match the payment fails it instead of paying', async () => {
    await debt(1000);
    const res = await B.post(`/api/groups/${g.id}/payments`, { purpose: 'settlement', targetId: A.user.id, amount: 1000 });
    const body = event(res.body.payment, { amountMinor: 1 });
    expect((await hook(body, signWebhook(secret, body, t.now()))).status).toBe(200);
    expect((await B.get(`/api/groups/${g.id}/payments/${res.body.payment.id}`)).body).toMatchObject({ status: 'failed', failureCode: 'amount_mismatch', receipt: null });
  });
});

describe('the fake gateway decides by amount', () => {
  it('a total ending in .13 is declined: no settlement, no receipt, the payer is told', async () => {
    await debt(998);
    const res = await B.post(`/api/groups/${g.id}/payments`, { purpose: 'settlement', targetId: A.user.id, amount: 998 });
    expect(res.body.quote).toMatchObject({ fee: 15, total: 1013 });
    await pay(res.body.checkoutUrl);
    const p = (await B.get(`/api/groups/${g.id}/payments/${res.body.payment.id}`)).body;
    expect(p).toMatchObject({ status: 'failed', failureCode: 'card_declined', receipt: null });
    expect((await t.db.select().from(settlements)).filter((s) => s.note === `payment ${p.id}`)).toHaveLength(0);
    expect((await t.db.select().from(notifications).where(eq(notifications.kind, 'payment_failed'))).map((n) => n.userId)).toContain(B.user.id);
    // paying the same checkout twice doesn't send a second event
    await pay(res.body.checkoutUrl);
    expect((await t.db.select().from(paymentEvents).where(eq(paymentEvents.paymentId, p.id)))).toHaveLength(1);
  });
});

describe('gam’eya shares through the gateway', () => {
  it('a gateway payment confirms the share; the last one completes the month', async () => {
    const sav = await makeGroup(A, 'savings', 'Pay circle');
    await join(B, sav.code);
    const month = new Date(t.now()).toISOString().slice(0, 7);
    const ga = await A.post(`/api/groups/${sav.id}/gameyas`, { title: 'Pay circle', amount: 10000, startMonth: month, orderMode: 'agreed', memberIds: [A.user.id, B.user.id] });
    const board = (await B.get(`/api/groups/${sav.id}/gameyas/${ga.body.id}`)).body;
    const share = board.months[0].payments.find((x: any) => x.payerId === B.user.id);
    const res = await B.post(`/api/groups/${sav.id}/payments`, { purpose: 'gameya', targetId: share.id });
    expect(res.body.payment.payeeId).toBe(A.user.id);
    await pay(res.body.checkoutUrl);
    const after = (await A.get(`/api/groups/${sav.id}/gameyas/${ga.body.id}`)).body.months[0];
    expect(after.payments.find((x: any) => x.payerId === B.user.id)).toMatchObject({ status: 'paid', confirmedBy: 'gateway' });
    expect(after.receivedAt).not.toBeNull();
    expect(after.paidIn).toBe(after.paidOut);
    // the receiver's own share is never paid through the gateway
    const own = board.months[0].payments.find((x: any) => x.payerId === A.user.id);
    expect((await A.post(`/api/groups/${sav.id}/payments`, { purpose: 'gameya', targetId: own.id })).status).toBe(409);
  });
});

describe('rules', () => {
  it('can’t pay more than owed, can’t pay yourself, others can’t see my payment, children can’t pay', async () => {
    expect((await B.post(`/api/groups/${g.id}/payments`, { purpose: 'settlement', targetId: A.user.id, amount: 999999 })).status).toBe(400);
    expect((await B.post(`/api/groups/${g.id}/payments`, { purpose: 'settlement', targetId: B.user.id, amount: 100 })).status).toBe(400);
    const mine = (await B.get(`/api/groups/${g.id}/payments`)).body;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p: any) => p.payerId === B.user.id || p.payeeId === B.user.id)).toBe(true);
    expect((await C.get(`/api/groups/${g.id}/payments/${mine[0].id}`)).status).toBe(404);
    expect((await C.get(`/api/groups/${g.id}/payments/${mine[0].id}/receipt`)).status).toBe(404);
    expect((await C.get(`/api/groups/${g.id}/payments`)).body).toEqual([]);
    expect((await A.get(`/api/groups/${g.id}/payments`)).body.length).toBe(mine.length); // the collector sees all
    // cross-group: another group's id → 404
    const X = await t.signIn('x@example.com', 'X');
    const xg = await makeGroup(X, 'roommates', 'X flat');
    expect((await X.get(`/api/groups/${xg.id}/payments/${mine[0].id}`)).status).toBe(404);
    expect((await X.get(`/api/groups/${xg.id}/payments/${mine[0].id}/receipt`)).status).toBe(404);
    expect((await X.post(`/api/groups/${xg.id}/payments`, { purpose: 'due', targetId: (await t.db.select().from(dueCharges))[0].id })).status).toBe(404);
  });

  it('without a gateway the routes answer 503 and the app is told', async () => {
    const off = await setup({ payments: null });
    const u = await off.signIn('u@example.com');
    const og = await makeGroup(u, 'roommates', 'Off');
    expect((await u.post(`/api/groups/${og.id}/payments`, { purpose: 'settlement', targetId: 'x', amount: 100 })).status).toBe(503);
    expect(await (await off.app.request('/api/config')).json()).toMatchObject({ payments: false });
    expect((await off.app.request('/fake-gateway/checkout/x')).status).not.toBe(200);
    await off.close();
    expect(await (await t.app.request('/api/config')).json()).toMatchObject({ payments: true, fee: { bps: 150, fixedMinor: 0 } });
  });
});
