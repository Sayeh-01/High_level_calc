import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications, tasks } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, D: Client, V: Client, X: Client;
let g: { id: string; code: string; group: any };
const api = (p: string) => `/api/groups/${g.id}${p}`;
const lowAlerts = async (itemId: string) => (await t.db.select().from(notifications).where(eq(notifications.kind, 'low_stock'))).filter((n: any) => n.data.itemId === itemId && n.userId === A.user.id);

beforeAll(async () => {
  t = await setup();
  t.setNow('2026-11-08T06:00:00Z');
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  D = await t.signIn('d@example.com', 'Dina');
  V = await t.signIn('v@example.com', 'Vendor Co');
  X = await t.signIn('x@example.com', 'Xavier');
  g = await makeGroup(A, 'company', 'Cafe Nile');
  for (const u of [B, C, D, V]) await join(u, g.code);
  await A.patch(api(`/members/${C.user.id}`), { role: 'manager' });
  await A.patch(api(`/members/${V.user.id}`), { role: 'vendor' });
});
afterAll(() => t.close());

describe('inventory (B9 v3.x): a low-stock alert fires once per threshold crossing', () => {
  it('alerts when stock crosses down to the threshold, stays quiet while low, re-arms after a restock', async () => {
    expect(g.group.modules).toEqual(expect.arrayContaining(['inventory', 'assets', 'approvals', 'contacts']));
    expect((await B.post(api('/inventory'), { name: 'Milk', quantity: 10 })).status).toBe(403);
    const milk = (await C.post(api('/inventory'), { name: 'Milk', unit: 'L', quantity: 12, lowAt: 5, vendorUserId: V.user.id })).body;
    const use = (n: number) => (t.advance(1000), B.post(api(`/inventory/${milk.id}/move`), { delta: -n, reason: 'used' }));
    await use(6); // 6 left
    expect(await lowAlerts(milk.id)).toHaveLength(0);
    expect((await use(1)).body).toMatchObject({ quantity: 5, low: true }); // crossed
    expect(await lowAlerts(milk.id)).toHaveLength(1);
    await use(2);
    await use(1);
    await B.post(api(`/inventory/${milk.id}/move`), { delta: 1 }); // 3, still low
    expect(await lowAlerts(milk.id)).toHaveLength(1);
    expect((await use(10)).body.error).toBe('not_enough_stock');
    expect((await C.post(api(`/inventory/${milk.id}/count`), { quantity: 20 })).body).toMatchObject({ quantity: 20, low: false }); // restocked: re-armed
    await use(16); // 4 → second crossing
    expect(await lowAlerts(milk.id)).toHaveLength(2);
    const moves = (await B.get(api(`/inventory/${milk.id}/moves`))).body;
    expect(moves[0]).toMatchObject({ delta: -16, after: 4 });
    expect((await B.get(api('/inventory'))).body[0]).toMatchObject({ id: milk.id, low: true });
  });

  it('concurrent use of the last items: stock never goes below zero and only one alert goes out', async () => {
    const cups = (await C.post(api('/inventory'), { name: 'Cups', quantity: 3, lowAt: 1 })).body;
    const results = await Promise.all([1, 2, 3, 4].map(() => B.post(api(`/inventory/${cups.id}/move`), { delta: -1 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect((await B.get(api('/inventory'))).body.find((i: any) => i.id === cups.id).quantity).toBe(0);
    expect(await lowAlerts(cups.id)).toHaveLength(1);
  });

  it('reorder becomes a task for the vendor', async () => {
    const milk = (await B.get(api('/inventory'))).body.find((i: any) => i.name === 'Milk');
    const task = await C.post(api(`/inventory/${milk.id}/reorder`), { quantity: 24 });
    expect(task.body).toMatchObject({ title: 'Reorder 24 L Milk', assigneeId: V.user.id });
    expect((await V.get(api(`/tasks/${task.body.id}`))).body.task.title).toBe('Reorder 24 L Milk');
  });
});

describe('assets & maintenance', () => {
  it('a due service creates one task; logging the service schedules the next', async () => {
    const vendor = (await C.post(api('/contacts'), { name: 'CoolFix', kind: 'vendor', phone: '+201000000000' })).body;
    const fridge = (await C.post(api('/assets'), { name: 'Fridge', location: 'Kitchen', serviceEveryDays: 90, lastServiceDay: '2026-08-15', vendorContactId: vendor.id })).body;
    expect(fridge.nextServiceDay).toBe('2026-11-13');
    t.setNow('2026-11-13T06:00:00Z'); // 08:00 Cairo
    await t.runJobs();
    await t.runJobs();
    expect((await t.db.select().from(tasks).where(eq(tasks.title, 'Service: Fridge')))).toHaveLength(1);
    const after = await B.post(api(`/assets/${fridge.id}/service`), { note: 'Gas refilled', costMinor: 45000 });
    expect(after.body).toMatchObject({ lastServiceDay: '2026-11-13', nextServiceDay: '2027-02-11' });
    expect((await B.get(api(`/assets/${fridge.id}/services`))).body[0]).toMatchObject({ note: 'Gas refilled', costMinor: 45000 });
  });
});

describe('spend approvals (B9 v3.x): approval limits apply per role', () => {
  it('within your own limit is approved at once; above it needs someone whose limit covers it', async () => {
    await A.put(api('/roles/supervisor'), { name: 'Supervisor', base: 'member', grant: ['approve'] });
    await A.patch(api(`/members/${D.user.id}`), { customRoleId: 'supervisor' });
    expect((await B.put(api('/spend-requests/limits'), { limits: { member: 1 } })).status).toBe(403);
    await A.put(api('/spend-requests/limits'), { limits: { member: 5000, manager: 50000, supervisor: 20000 } });

    expect((await B.post(api('/spend-requests'), { title: 'Napkins', amount: 3000, category: 'supplies' })).body).toMatchObject({ status: 'approved', decidedBy: 'auto' });
    const mid = (await B.post(api('/spend-requests'), { title: 'Blender', amount: 15000, category: 'equipment' })).body;
    const big = (await B.post(api('/spend-requests'), { title: 'Espresso machine', amount: 80000, category: 'equipment' })).body;
    expect(mid.status).toBe('pending');
    expect((await t.db.select().from(notifications).where(eq(notifications.kind, 'spend_request'))).map((n) => n.userId)).toEqual(expect.arrayContaining([A.user.id, C.user.id]));

    expect((await B.post(api(`/spend-requests/${mid.id}/approve`))).status).toBe(403); // members can't approve
    expect((await D.post(api(`/spend-requests/${big.id}/approve`))).body.error).toBe('over_your_limit'); // supervisor: 200.00
    expect((await C.post(api(`/spend-requests/${big.id}/approve`))).body.error).toBe('over_your_limit'); // manager: 500.00
    expect((await D.post(api(`/spend-requests/${mid.id}/approve`))).body.status).toBe('approved'); // 150.00 ≤ 200.00
    expect((await A.post(api(`/spend-requests/${big.id}/approve`))).body.status).toBe('approved'); // owner: no limit
    expect((await A.post(api(`/spend-requests/${big.id}/approve`))).status).toBe(409);
    // a manager's own request above their limit waits too, and they can't approve it themselves
    const own = (await C.post(api('/spend-requests'), { title: 'Sign', amount: 60000 })).body;
    expect(own.status).toBe('pending');
    expect((await C.post(api(`/spend-requests/${own.id}/approve`))).body.error).toBe('own_request');
    // members see only their own requests
    expect((await B.get(api('/spend-requests'))).body.requests.every((r: any) => r.requesterId === B.user.id)).toBe(true);
    expect((await C.get(api('/spend-requests'))).body.myLimit).toBe(50000);
  });

  it('cross-group: another group’s stock item, asset and request → 404', async () => {
    const xg = await makeGroup(X, 'company', 'X co');
    const item = (await B.get(api('/inventory'))).body[0];
    const asset = (await B.get(api('/assets'))).body[0];
    const req = (await A.get(api('/spend-requests'))).body.requests[0];
    for (const [m, p, b] of [
      ['POST', `/api/groups/${xg.id}/inventory/${item.id}/move`, { delta: -1 }],
      ['POST', `/api/groups/${xg.id}/inventory/${item.id}/reorder`, { quantity: 1 }],
      ['GET', `/api/groups/${xg.id}/inventory/${item.id}/moves`],
      ['POST', `/api/groups/${xg.id}/assets/${asset.id}/service`, {}],
      ['POST', `/api/groups/${xg.id}/spend-requests/${req.id}/approve`, {}],
    ] as [string, string, unknown?][])
      expect((await X.req(m, p, b)).status, `${m} ${p}`).toBe(404);
  });
});
