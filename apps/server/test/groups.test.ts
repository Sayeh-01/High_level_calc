import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client;

beforeAll(async () => {
  t = await setup();
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
});
afterAll(() => t.close());

describe('groups & templates', () => {
  it('creates a Sport group with its modules, role names, defaults and starter content', async () => {
    const g = await makeGroup(A, 'sport');
    expect(g.group.modules).toEqual(expect.arrayContaining(['events', 'expenses', 'chat', 'polls', 'lists']));
    expect(g.group.settings).toMatchObject({ eventCapacity: 12, waitlist: true });
    const lists = await A.get(`/api/groups/${g.id}/lists`);
    expect(lists.body.map((l: any) => l.title)).toContain('Equipment');
    const events = await A.get(`/api/groups/${g.id}/events`);
    expect(events.body.length).toBeGreaterThan(0);
    expect(events.body[0]).toMatchObject({ title: 'Weekly match', capacity: 12, waitlist: true });
    const activity = await A.get(`/api/groups/${g.id}/activity`);
    expect(activity.body[0]).toMatchObject({ verb: 'created', entity: 'group' });
  });

  it('Custom starts blank with the picked modules; unknown modules are dropped', async () => {
    const g = await makeGroup(A, 'custom', 'Book club', { modules: ['polls', 'chat', 'nope'] });
    expect(g.group.modules).toEqual(['polls', 'chat']);
  });

  it('Arabic starter content when created in Arabic', async () => {
    const g = await makeGroup(A, 'family', 'العيلة', { lang: 'ar' });
    const lists = await A.get(`/api/groups/${g.id}/lists`);
    expect(lists.body[0].title).toBe('البقالة');
  });

  it('invite code → preview → join with a per-group display name', async () => {
    const g = await makeGroup(A, 'roommates', 'Flat 4B');
    const preview = await B.get(`/api/invites/${g.code}`);
    expect(preview.body).toMatchObject({ name: 'Flat 4B', inviter: 'Amal', memberCount: 1, alreadyMember: false });
    await join(B, g.code.toLowerCase(), 'Bassem (flat)');
    const detail = await B.get(`/api/groups/${g.id}`);
    expect(detail.body.members.map((m: any) => m.displayName)).toEqual(['Amal', 'Bassem (flat)']);
    expect(detail.body.me.role).toBe('member');
    // rotation chores pick up new members
    const tasks = await A.get(`/api/groups/${g.id}/tasks`);
    expect(tasks.body[0].rotation).toEqual([A.user.id, B.user.id]);
    const list = await B.get('/api/groups');
    expect(list.body.find((x: any) => x.id === g.id)).toMatchObject({ memberCount: 2, role: 'member' });
  });

  it('B9 #6: a Member cannot change modules (403); only the Owner can delete the group', async () => {
    const g = await makeGroup(A, 'study', 'Masters');
    await join(B, g.code);
    expect((await B.put(`/api/groups/${g.id}/modules`, { modules: ['chat'] })).status).toBe(403);
    expect((await B.patch(`/api/groups/${g.id}`, { name: 'x' })).status).toBe(403);
    // an Admin can change modules but still cannot delete
    expect((await A.patch(`/api/groups/${g.id}/members/${B.user.id}`, { role: 'admin' })).status).toBe(200);
    expect((await B.put(`/api/groups/${g.id}/modules`, { modules: ['chat', 'tasks'] })).status).toBe(200);
    expect((await B.del(`/api/groups/${g.id}`)).status).toBe(403);
    expect((await A.del(`/api/groups/${g.id}`)).status).toBe(200);
    expect((await A.get(`/api/groups/${g.id}`)).status).toBe(404);
  });

  it('switching a module off hides its routes', async () => {
    const g = await makeGroup(A, 'work', 'Team');
    expect((await A.get(`/api/groups/${g.id}/tasks`)).status).toBe(200);
    await A.put(`/api/groups/${g.id}/modules`, { modules: ['chat'] });
    expect((await A.get(`/api/groups/${g.id}/tasks`)).status).toBe(404);
  });

  it('removed members lose access immediately (404)', async () => {
    const g = await makeGroup(A, 'family', 'Home');
    await join(C, g.code);
    expect((await C.get(`/api/groups/${g.id}`)).status).toBe(200);
    expect((await A.del(`/api/groups/${g.id}/members/${C.user.id}`)).status).toBe(200);
    expect((await C.get(`/api/groups/${g.id}`)).status).toBe(404);
    expect((await C.get(`/api/groups/${g.id}/lists`)).status).toBe(404);
  });

  it('members can invite only when the group allows it', async () => {
    const g = await makeGroup(A, 'sport', 'Club');
    await join(B, g.code);
    expect((await B.get(`/api/groups/${g.id}/invite`)).status).toBe(200);
    await A.patch(`/api/groups/${g.id}`, { membersCanInvite: false });
    expect((await B.get(`/api/groups/${g.id}/invite`)).status).toBe(403);
  });

  it('rotating the code revokes the old one', async () => {
    const g = await makeGroup(A, 'sport', 'Club 2');
    const fresh = await A.post(`/api/groups/${g.id}/invite/rotate`);
    expect(fresh.body.code).not.toBe(g.code);
    expect((await C.get(`/api/invites/${g.code}`)).status).toBe(404);
    expect(fresh.body.deepLink).toBe(`circleapp://join/${fresh.body.code}`);
  });

  it('transfer ownership, then the old owner can leave', async () => {
    const g = await makeGroup(A, 'work', 'Ops');
    await join(B, g.code);
    expect((await A.post(`/api/groups/${g.id}/leave`)).status).toBe(409);
    expect((await A.post(`/api/groups/${g.id}/transfer`, { userId: B.user.id })).status).toBe(200);
    expect((await A.post(`/api/groups/${g.id}/leave`)).status).toBe(200);
    const detail = await B.get(`/api/groups/${g.id}`);
    expect(detail.body.me.role).toBe('owner');
    expect(detail.body.members).toHaveLength(1);
  });

  it('per-group display name', async () => {
    const g = await makeGroup(A, 'work', 'Office');
    await A.patch(`/api/groups/${g.id}/me`, { displayName: 'Eng. Amal' });
    const detail = await A.get(`/api/groups/${g.id}`);
    expect(detail.body.me.displayName).toBe('Eng. Amal');
  });

  it('requires a session', async () => {
    const res = await t.raw('GET', '/api/groups');
    expect(res.status).toBe(401);
  });
});

describe('group photo', () => {
  it('must be a file uploaded to this group', async () => {
    const g = await makeGroup(A, 'family', 'Photo test');
    const other = await makeGroup(A, 'family', 'Other');
    const f = await A.post(`/api/groups/${other.id}/files`, { mime: 'image/png', size: 4 });
    expect((await A.patch(`/api/groups/${g.id}`, { photo: f.body.fileId })).status).toBe(400);
    const own = await A.post(`/api/groups/${g.id}/files`, { mime: 'image/png', size: 4 });
    expect((await A.patch(`/api/groups/${g.id}`, { photo: own.body.fileId })).status).toBe(200);
  });
});
