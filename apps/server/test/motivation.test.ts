import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, ORIGIN, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let P: Client, M: Client;
let g: { id: string; code: string };

beforeAll(async () => {
  t = await setup();
  P = await t.signIn('parent@example.com', 'Mama');
  M = await t.signIn('member@example.com', 'Omar');
  g = await makeGroup(P, 'family', 'Home');
  await join(M, g.code);
});
afterAll(() => t.close());

async function childClient(childId: string, pin: string): Promise<Client> {
  const res = await t.raw('POST', '/api/auth/child/sign-in', { childId, pin });
  if (res.status !== 200) throw new Error(`child sign-in ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const req = async (method: string, path: string, body?: unknown) => {
    const r = await t.raw(method, path, body, cookie);
    const text = await r.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    return { status: r.status, body: parsed };
  };
  return { user: { id: childId, email: '', name: '' }, cookie, req, get: (p) => req('GET', p), post: (p, b) => req('POST', p, b ?? {}), patch: (p, b) => req('PATCH', p, b ?? {}), put: (p, b) => req('PUT', p, b ?? {}), del: (p) => req('DELETE', p) };
}

describe('points, rewards, fairness', () => {
  it('completing a chore earns its points; fairness shares add up to 100%', async () => {
    const a = await P.post(`/api/groups/${g.id}/tasks`, { title: 'Dishes', points: 3, assigneeId: P.user.id });
    const b = await P.post(`/api/groups/${g.id}/tasks`, { title: 'Laundry', points: 5, assigneeId: M.user.id });
    const c = await P.post(`/api/groups/${g.id}/tasks`, { title: 'Bins', points: 4, assigneeId: M.user.id });
    await P.post(`/api/groups/${g.id}/tasks/${a.body.id}/complete`);
    await M.post(`/api/groups/${g.id}/tasks/${b.body.id}/complete`);
    await M.post(`/api/groups/${g.id}/tasks/${c.body.id}/complete`);
    const pts = await P.get(`/api/groups/${g.id}/points`);
    expect(pts.body.balances[P.user.id]).toBe(3);
    expect(pts.body.balances[M.user.id]).toBe(9);
    expect(pts.body.fairness).toEqual({ [P.user.id]: 25, [M.user.id]: 75 });
    expect(Object.values(pts.body.fairness as Record<string, number>).reduce((s, v) => s + v, 0)).toBe(100);
    expect(pts.body.streaks[M.user.id]).toBe(1);
  });

  it('B9 v1.2: two concurrent redemptions cannot take points below 0', async () => {
    // Omar has 9 points; a 7-point reward can only be bought once
    const reward = await P.post(`/api/groups/${g.id}/rewards`, { title: 'Extra hour of games', cost: 7, emoji: '🎮' });
    expect((await M.post(`/api/groups/${g.id}/rewards`, { title: 'x', cost: 1 })).status).toBe(403);
    const [x, y] = await Promise.all([M.post(`/api/groups/${g.id}/rewards/${reward.body.id}/redeem`), M.post(`/api/groups/${g.id}/rewards/${reward.body.id}/redeem`)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const pts = await M.get(`/api/groups/${g.id}/points`);
    expect(pts.body.me.balance).toBe(2);
    // a burst of redemptions of a 1-point reward stops exactly at 0
    const cheap = await P.post(`/api/groups/${g.id}/rewards`, { title: 'Sticker', cost: 1 });
    const burst = await Promise.all(Array.from({ length: 6 }, () => M.post(`/api/groups/${g.id}/rewards/${cheap.body.id}/redeem`)));
    expect(burst.filter((r) => r.status === 200)).toHaveLength(2);
    expect((await M.get(`/api/groups/${g.id}/points`)).body.me.balance).toBe(0);
  });

  it('cancel refunds; fulfil needs an approver', async () => {
    await P.post(`/api/groups/${g.id}/points/adjust`, { userId: M.user.id, delta: 5, note: 'birthday' });
    const reward = await P.post(`/api/groups/${g.id}/rewards`, { title: 'Ice cream', cost: 5 });
    const red = await M.post(`/api/groups/${g.id}/rewards/${reward.body.id}/redeem`);
    expect((await M.get(`/api/groups/${g.id}/points`)).body.me.balance).toBe(0);
    expect((await M.post(`/api/groups/${g.id}/redemptions/${red.body.id}/fulfill`)).status).toBe(403);
    await M.post(`/api/groups/${g.id}/redemptions/${red.body.id}/cancel`);
    expect((await M.get(`/api/groups/${g.id}/points`)).body.me.balance).toBe(5);
    // adjusting below zero is refused
    expect((await P.post(`/api/groups/${g.id}/points/adjust`, { userId: M.user.id, delta: -6 })).status).toBe(409);
  });
});

describe('Child accounts', () => {
  let childId: string;
  let K: Client;

  beforeAll(async () => {
    expect((await M.post(`/api/groups/${g.id}/children`, { name: 'Lina', pin: '1234' })).status).toBe(403);
    const res = await P.post(`/api/groups/${g.id}/children`, { name: 'Lina', pin: '1234' });
    childId = res.body.id;
    K = await childClient(childId, '1234');
  });

  it('signs in with a PIN on a shared device; wrong PINs lock it for 15 minutes', async () => {
    const me = await K.get('/api/me');
    expect(me.body).toMatchObject({ name: 'Lina', isChild: true, managedBy: P.user.id });
    const other = await P.post(`/api/groups/${g.id}/children`, { name: 'Yousef', pin: '4321' });
    for (let i = 0; i < 5; i++) expect((await t.raw('POST', '/api/auth/child/sign-in', { childId: other.body.id, pin: '0000' })).status).toBe(401);
    expect((await t.raw('POST', '/api/auth/child/sign-in', { childId: other.body.id, pin: '4321' })).status).toBe(429);
    t.advance(16 * 60_000);
    expect((await t.raw('POST', '/api/auth/child/sign-in', { childId: other.body.id, pin: '4321' })).status).toBe(200);
    // adults can't be signed into with a PIN
    expect((await t.raw('POST', '/api/auth/child/sign-in', { childId: P.user.id, pin: '1234' })).status).toBe(401);
    // the parent sees and manages their children
    const kids = await P.get('/api/me/children');
    expect(kids.body.map((k: any) => k.name).sort()).toEqual(['Lina', 'Yousef']);
    expect((await M.post(`/api/me/children/${childId}/pin`, { pin: '9999' })).status).toBe(404);
  });

  it('B9 v1.2: a Child is blocked on every money route (sweep)', async () => {
    const moneyRoutes = t.router.registry.filter((r) => r.path.includes(':groupId') && (r.perm === 'money.read' || r.perm === 'money.write'));
    expect(moneyRoutes.length).toBeGreaterThanOrEqual(7);
    // switch on every module that has money routes, so the permission check (not "module off") is what answers
    const mods = (await P.get(`/api/groups/${g.id}`)).body.group.modules;
    const moneyModules = [...new Set(moneyRoutes.map((r) => r.module).filter(Boolean))] as string[];
    expect((await P.put(`/api/groups/${g.id}/modules`, { modules: [...new Set([...mods, ...moneyModules])] })).status).toBe(200);
    const failures: string[] = [];
    for (const r of moneyRoutes) {
      const path = r.path.replace(':groupId', g.id).replace(/:[A-Za-z]+/g, 'x');
      const res = await K.req(r.method, path, r.method === 'GET' ? undefined : {});
      if (res.status !== 403) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
    const today = await K.get('/api/me/today');
    expect(today.body.money).toEqual([]);
  });

  it('a Child can do lists and chores but not create tasks, groups or join others', async () => {
    const list = (await P.get(`/api/groups/${g.id}/lists`)).body[0];
    expect((await K.post(`/api/groups/${g.id}/lists/${list.id}/items`, { title: 'Juice' })).status).toBe(200);
    expect((await K.post(`/api/groups/${g.id}/tasks`, { title: 'x' })).status).toBe(403);
    expect((await K.post('/api/groups', { templateId: 'custom', name: 'secret', lang: 'en' })).status).toBe(403);
    const elsewhere = await makeGroup(M, 'sport', 'Outside');
    expect((await K.get(`/api/invites/${elsewhere.code}`)).status).toBe(403);
    expect((await K.post(`/api/invites/${elsewhere.code}/join`)).status).toBe(403);
    expect((await K.post(`/api/groups/${g.id}/guest-links`, { entity: 'list', entityId: list.id })).status).toBe(403);
    expect((await K.del('/api/me')).status).toBe(403);
    expect((await K.post(`/api/groups/${g.id}/messages`, { body: 'hi mama' })).status).toBe(200);
  });

  it('a Child’s chore waits for parent approval before points are awarded', async () => {
    const task = await P.post(`/api/groups/${g.id}/tasks`, { title: 'Tidy room', points: 10, assigneeId: childId });
    await K.post(`/api/groups/${g.id}/tasks/${task.body.id}/complete`);
    expect((await K.get(`/api/groups/${g.id}/points`)).body.me.balance).toBe(0);
    const pending = await P.get(`/api/groups/${g.id}/approvals`);
    expect(pending.body).toHaveLength(1);
    expect((await K.get(`/api/groups/${g.id}/approvals`)).status).toBe(403);
    expect((await M.post(`/api/groups/${g.id}/completions/${pending.body[0].id}/approve`)).status).toBe(403);
    expect((await P.post(`/api/groups/${g.id}/completions/${pending.body[0].id}/approve`)).status).toBe(200);
    expect((await K.get(`/api/groups/${g.id}/points`)).body.me.balance).toBe(10);
    // approving twice does not double-award
    await P.post(`/api/groups/${g.id}/completions/${pending.body[0].id}/approve`);
    expect((await K.get(`/api/groups/${g.id}/points`)).body.me.balance).toBe(10);
  });
});

describe('voice notes', () => {
  it('a message can carry an audio file from this group; images are not audio', async () => {
    const audio = await M.post(`/api/groups/${g.id}/files`, { mime: 'audio/m4a', size: 3 });
    await t.app.request(audio.body.uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2, 3]) });
    const msg = await M.post(`/api/groups/${g.id}/messages`, { body: '', audioFileId: audio.body.fileId, audioMs: 4200 });
    expect(msg.body).toMatchObject({ audioFileId: audio.body.fileId, audioMs: 4200 });
    const img = await M.post(`/api/groups/${g.id}/files`, { mime: 'image/png', size: 3 });
    expect((await M.post(`/api/groups/${g.id}/messages`, { body: '', audioFileId: img.body.fileId })).status).toBe(400);
  });
});

describe('cross-group isolation for v1.2 entities', () => {
  it('rewards, redemptions and completions of another group → 404', async () => {
    const X = await t.signIn('x@example.com');
    const mine = await makeGroup(X, 'family', 'X home');
    const reward = await P.post(`/api/groups/${g.id}/rewards`, { title: 'Movie', cost: 1 });
    const task = await P.post(`/api/groups/${g.id}/tasks`, { title: 'T', points: 1, assigneeId: P.user.id });
    await P.post(`/api/groups/${g.id}/tasks/${task.body.id}/complete`);
    const red = await P.post(`/api/groups/${g.id}/rewards/${reward.body.id}/redeem`);
    expect((await X.post(`/api/groups/${mine.id}/rewards/${reward.body.id}/redeem`)).status).toBe(404);
    expect((await X.del(`/api/groups/${mine.id}/rewards/${reward.body.id}`)).status).toBe(404);
    expect((await X.post(`/api/groups/${mine.id}/redemptions/${red.body.id}/cancel`)).status).toBe(404);
    const comp = (await P.get(`/api/groups/${g.id}/tasks/${task.body.id}`)).body.completions[0].id;
    expect((await X.post(`/api/groups/${mine.id}/completions/${comp}/approve`)).status).toBe(404);
    expect(ORIGIN).toBeTruthy();
  });
});
