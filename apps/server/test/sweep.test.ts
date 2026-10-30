import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

// B6/B9: walk every registered /groups/:groupId route as a non-member; every one must return 404.
// New routes are covered automatically because the list comes from the app itself.

let t: TestApp;
let owner: Client, outsider: Client;
let groupId: string;

beforeAll(async () => {
  t = await setup();
  owner = await t.signIn('owner@example.com');
  outsider = await t.signIn('outsider@example.com');
  groupId = (await makeGroup(owner, 'sport')).id;
});
afterAll(() => t.close());

export function groupRoutes(app: TestApp['app']) {
  const seen = new Set<string>();
  return app.routes
    .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/groups/:groupId'))
    .filter((r) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

describe('route sweep', () => {
  it('no two routes share a method and path (the first one would silently win)', () => {
    const seen = new Map<string, number>();
    for (const r of t.router.registry) seen.set(`${r.method} ${r.path}`, (seen.get(`${r.method} ${r.path}`) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it('finds the group routes', () => {
    expect(groupRoutes(t.app).length).toBeGreaterThan(40);
  });

  it('every group route returns 404 to a non-member', async () => {
    const failures: string[] = [];
    for (const r of groupRoutes(t.app)) {
      const path = r.path.replace(':groupId', groupId).replace(/:[A-Za-z]+/g, 'x');
      const res = await outsider.req(r.method, path, r.method === 'GET' ? undefined : {});
      if (res.status !== 404) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('every group route returns 401 without a session', async () => {
    const failures: string[] = [];
    for (const r of groupRoutes(t.app)) {
      const path = r.path.replace(':groupId', groupId).replace(/:[A-Za-z]+/g, 'x');
      const res = await t.raw(r.method, path, r.method === 'GET' ? undefined : {});
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('cross-group isolation (B7 #1): a member of A using B’s item id gets 404', () => {
  let gA: string, gB: string, memberA: Client, ownerB: Client;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    memberA = await t.signIn('member-a@example.com');
    ownerB = await t.signIn('owner-b@example.com');
    gA = (await makeGroup(memberA, 'roommates', 'A')).id;
    const b = await makeGroup(ownerB, 'roommates', 'B');
    gB = b.id;
    const peer = await t.signIn('peer-b@example.com');
    await join(peer, b.code);
    ids.task = (await ownerB.post(`/api/groups/${gB}/tasks`, { title: 'B task' })).body.id;
    ids.event = (await ownerB.post(`/api/groups/${gB}/events`, { title: 'B event', startsAt: '2026-11-10T18:00:00+02:00' })).body.id;
    ids.list = (await ownerB.post(`/api/groups/${gB}/lists`, { title: 'B list' })).body.id;
    ids.item = (await ownerB.post(`/api/groups/${gB}/lists/${ids.list}/items`, { title: 'B item' })).body.id;
    ids.expense = (await ownerB.post(`/api/groups/${gB}/expenses`, { title: 'B exp', amount: 1000, payerId: ownerB.user.id, split: { kind: 'equal', members: [ownerB.user.id, peer.user.id] } })).body.id;
    ids.settlement = (await peer.post(`/api/groups/${gB}/settlements`, { toId: ownerB.user.id, amount: 500, method: 'cash' })).body.id;
    ids.poll = (await ownerB.post(`/api/groups/${gB}/polls`, { question: 'B?', options: ['x', 'y'] })).body.id;
    ids.message = (await ownerB.post(`/api/groups/${gB}/messages`, { body: 'B msg' })).body.id;
    ids.file = (await ownerB.post(`/api/groups/${gB}/files`, { mime: 'image/png', size: 10 })).body.fileId;
    for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`setup failed for ${k}`);
  });

  const cases: [string, (g: string) => [string, string, unknown?][]][] = [
    ['task', (g) => [['GET', `/api/groups/${g}/tasks/${ids.task}`], ['PATCH', `/api/groups/${g}/tasks/${ids.task}`, { title: 'x' }], ['POST', `/api/groups/${g}/tasks/${ids.task}/complete`, {}], ['POST', `/api/groups/${g}/tasks/${ids.task}/comments`, { body: 'x' }], ['DELETE', `/api/groups/${g}/tasks/${ids.task}`]]],
    ['event', (g) => [['GET', `/api/groups/${g}/events/${ids.event}`], ['POST', `/api/groups/${g}/events/${ids.event}/rsvp`, { status: 'going' }], ['PATCH', `/api/groups/${g}/events/${ids.event}`, { title: 'x' }], ['POST', `/api/groups/${g}/events/${ids.event}/split`, { amount: 100 }], ['DELETE', `/api/groups/${g}/events/${ids.event}`]]],
    ['list', (g) => [['GET', `/api/groups/${g}/lists/${ids.list}`], ['POST', `/api/groups/${g}/lists/${ids.list}/items`, { title: 'x' }], ['DELETE', `/api/groups/${g}/lists/${ids.list}`]]],
    ['list item', (g) => [['PATCH', `/api/groups/${g}/lists/${ids.list}/items/${ids.item}`, { checked: true }]]],
    ['expense', (g) => [['POST', `/api/groups/${g}/expenses/${ids.expense}/reverse`, {}]]],
    ['settlement', (g) => [['POST', `/api/groups/${g}/settlements/${ids.settlement}/confirm`, {}], ['POST', `/api/groups/${g}/settlements/${ids.settlement}/reject`, {}]]],
    ['poll', (g) => [['GET', `/api/groups/${g}/polls/${ids.poll}`], ['POST', `/api/groups/${g}/polls/${ids.poll}/close`, {}]]],
    ['message', (g) => [['POST', `/api/groups/${g}/messages/${ids.message}/pin`, {}], ['DELETE', `/api/groups/${g}/messages/${ids.message}`], ['POST', `/api/groups/${g}/announcements/${ids.message}/read`, {}]]],
    ['file', (g) => [['GET', `/api/groups/${g}/files/${ids.file}`]]],
  ];

  for (const [name, build] of cases) {
    it(name, async () => {
      for (const [method, path, body] of build(gA)) {
        const res = await memberA.req(method, path, body);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });
  }

  it('B’s items are untouched', async () => {
    const task = await ownerB.get(`/api/groups/${gB}/tasks/${ids.task}`);
    expect(task.body.task).toMatchObject({ title: 'B task', status: 'open' });
  });

  it('cannot reference another group’s files, events or members in a write', async () => {
    expect((await memberA.post(`/api/groups/${gA}/messages`, { body: 'x', imageFileId: ids.file })).status).toBe(400);
    expect((await memberA.post(`/api/groups/${gA}/expenses`, { title: 'x', amount: 100, payerId: memberA.user.id, split: { kind: 'equal', members: [memberA.user.id] }, eventId: ids.event })).status).toBe(400);
    expect((await memberA.post(`/api/groups/${gA}/tasks`, { title: 'x', assigneeId: ownerB.user.id })).status).toBe(400);
  });
});
