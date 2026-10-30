import { MODULE_IDS, can, moduleName, type Role } from '@circle/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications } from '../src/db/schema';
import { grantEntitlement } from '../src/entitlements';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, X: Client;
let g: { id: string; code: string; group: any };
const api = (p: string) => `/api/groups/${g.id}${p}`;

beforeAll(async () => {
  t = await setup();
  t.setNow('2026-11-08T06:00:00Z');
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  X = await t.signIn('x@example.com', 'Xavier');
  g = await makeGroup(A, 'company', 'Cafe Nile');
  await join(B, g.code);
  await join(C, g.code);
});
afterAll(() => t.close());

describe('Company template', () => {
  it('has checklists, time off that needs approval, and the SOP wiki', async () => {
    expect(g.group.modules).toEqual(expect.arrayContaining(['tasks', 'checklists', 'leave', 'notes']));
    expect(g.group.settings.leaveApproval).toBe(true);
    expect(moduleName('company', 'notes', 'en')).toBe('SOP wiki');
    expect((await B.post(api('/time-off'), { startDay: '2026-11-20', endDay: '2026-11-21' })).body.status).toBe('pending');
    const me = (await B.get(api(''))).body.me;
    expect(me.role).toBe('member');
  });
});

describe('custom roles', () => {
  it('only owners/admins define them, and never above their own powers', async () => {
    expect((await B.put(api('/roles/cashier'), { name: 'Cashier', base: 'member', grant: ['money.write'] })).status).toBe(403);
    expect((await A.put(api('/roles/boss'), { name: 'Boss', base: 'member', grant: ['group.delete'] })).body.error).toBe('owner_only');
    expect((await A.put(api('/roles/Bad Id'), { name: 'x', base: 'member' })).status).toBe(400);
    expect((await A.put(api('/roles/cashier'), { name: 'Cashier', base: 'member', grant: ['money.write'], deny: ['items.create'] })).status).toBe(200);
    expect((await A.get(api('/roles'))).body).toEqual([{ id: 'cashier', name: 'Cashier', base: 'member', grant: ['money.write'], deny: ['items.create'] }]);
    expect((await A.patch(api(`/members/${B.user.id}`), { customRoleId: 'nope' })).status).toBe(400);
    expect((await A.patch(api(`/members/${B.user.id}`), { customRoleId: 'cashier' })).status).toBe(200);
    expect((await B.post(api('/tasks'), { title: 'Not allowed' })).status).toBe(403);
    // deleting the role sends its members back to their base role
    await A.put(api('/roles/temp'), { name: 'Temp', base: 'member', deny: ['chat'] });
    await A.patch(api(`/members/${C.user.id}`), { customRoleId: 'temp' });
    expect((await C.get(api('/messages'))).status).toBe(403);
    expect((await A.del(api('/roles/temp'))).status).toBe(200);
    expect((await C.get(api('/messages'))).status).toBe(200);
  });

  it('custom roles pass the sweep (B9 v3.x): every group route answers exactly as the permission matrix says', async () => {
    await A.put(api('/modules'), { modules: MODULE_IDS });
    await A.put(api('/roles/viewer'), { name: 'Viewer', base: 'member', deny: ['items.read', 'chat', 'money.read'] });
    await A.put(api('/roles/supervisor'), { name: 'Supervisor', base: 'member', grant: ['items.manage', 'approve', 'members.invite'] });
    const D = await t.signIn('d@example.com', 'Dina');
    await join(D, g.code);
    await A.patch(api(`/members/${C.user.id}`), { customRoleId: 'viewer' });
    await A.patch(api(`/members/${D.user.id}`), { customRoleId: 'supervisor' });
    const policy = (await A.get(api(''))).body.group.settings;
    const people: [Client, string][] = [[B, 'cashier'], [C, 'viewer'], [D, 'supervisor']];
    const routes = t.router.registry.filter((r) => r.path.startsWith('/api/groups/:groupId') && r.perm && r.method !== 'DELETE');
    expect(routes.length).toBeGreaterThan(150);
    const wrong: string[] = [];
    for (const [who, roleId] of people) {
      for (const r of routes) {
        const allowed = can('member' as Role, r.perm!, policy, roleId);
        const path = r.path.replace(':groupId', g.id).replace(/:[A-Za-z]+/g, 'x');
        const res = await who.req(r.method, path, r.method === 'GET' ? undefined : {});
        if (!allowed && res.status !== 403) wrong.push(`${roleId} ${r.method} ${r.path} → ${res.status} (should be 403)`);
        if (allowed && res.status === 403 && res.body?.error === 'forbidden' && !r.path.includes(':')) wrong.push(`${roleId} ${r.method} ${r.path} → 403 (allowed by role)`);
      }
    }
    expect(wrong).toEqual([]);
    // and a custom role never opens another group: still 404 there
    const other = await makeGroup(X, 'company', 'Other cafe');
    expect((await D.get(`/api/groups/${other.id}/tasks`)).status).toBe(404);
  });
});

describe('departments (sub-groups)', () => {
  it('are made from the parent’s members; leads join every department; only chosen people see it', async () => {
    expect((await B.post(api('/subgroups'), { name: 'Kitchen', memberIds: [] })).status).toBe(403);
    expect((await A.post(api('/subgroups'), { name: 'Kitchen', memberIds: [X.user.id] })).status).toBe(400);
    const k = await A.post(api('/subgroups'), { name: 'Kitchen', emoji: '🍳', memberIds: [B.user.id] });
    expect(k.status).toBe(200);
    expect(k.body.parentId).toBe(g.id);
    expect((await B.get('/api/groups')).body.map((x: any) => x.id)).toContain(k.body.id);
    expect((await C.get('/api/groups')).body.map((x: any) => x.id)).not.toContain(k.body.id);
    expect((await C.get(`/api/groups/${k.body.id}/tasks`)).status).toBe(404);
    expect((await B.get(api('/subgroups'))).body).toEqual([{ id: k.body.id, name: 'Kitchen', emoji: '🍳', color: g.group.color, member: true, members: 2 }]);
    expect((await A.get(`/api/groups/${k.body.id}`)).body.me.role).toBe('owner');
    expect((await A.post(`/api/groups/${k.body.id}/subgroups`, { name: 'Nested' })).body.error).toBe('no_nested_departments');
    // a department is covered by the parent's plan
    expect((await A.get(`/api/groups/${k.body.id}/plan`)).body.limit).toBe(15);
    await grantEntitlement(t.db, { scope: 'group', subjectId: g.id, plan: 'group_pro', grantedBy: 'test', now: t.now() });
    expect((await A.get(`/api/groups/${k.body.id}/plan`)).body.limit).toBe(100);
  });
});

describe('checklists', () => {
  let opening: any;
  it('opening checklist: time-stamped ticks, photo proof where asked, one run per day', async () => {
    expect((await B.post(api('/checklists'), { title: 'x', kind: 'opening', items: [{ text: 'x' }] })).status).toBe(403);
    opening = (await A.post(api('/checklists'), { title: 'Opening', kind: 'opening', items: [{ text: 'Unlock and lights on' }, { text: 'Coffee machine on', photo: true }] })).body;
    await A.patch(api(`/members/${B.user.id}`), { customRoleId: null });
    const run = (await B.get(api(`/checklists/${opening.id}/run`))).body.run;
    expect(run).toMatchObject({ day: '2026-11-08', checks: {} });
    t.advance(60_000);
    expect((await B.post(api(`/checklists/${opening.id}/items/i1/check`))).body.checks.i1).toMatchObject({ at: t.now().toISOString(), by: B.user.id, photoFileId: null });
    expect((await B.post(api(`/checklists/${opening.id}/items/i1/check`))).status).toBe(409);
    expect((await B.post(api(`/checklists/${opening.id}/items/i2/check`))).body.error).toBe('photo_required');
    const xg = await makeGroup(X, 'company', 'X co');
    const foreign = await X.post(`/api/groups/${xg.id}/files`, { mime: 'image/jpeg', size: 3 });
    await t.app.request(foreign.body.uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2, 3]) });
    expect((await B.post(api(`/checklists/${opening.id}/items/i2/check`), { photoFileId: foreign.body.fileId })).body.error).toBe('bad_file');
    const up = await B.post(api('/files'), { mime: 'image/jpeg', size: 3 });
    await t.app.request(up.body.uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2, 3]) });
    const done = await B.post(api(`/checklists/${opening.id}/items/i2/check`), { photoFileId: up.body.fileId });
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.checks.i2.photoFileId).toBe(up.body.fileId);
    expect((await t.db.select().from(notifications).where(eq(notifications.kind, 'checklist_done'))).map((n) => n.userId)).toContain(A.user.id);
    // tomorrow starts empty; history keeps both days
    t.setNow('2026-11-09T06:00:00Z');
    expect((await B.get(api(`/checklists/${opening.id}/run`))).body.run).toMatchObject({ day: '2026-11-09', checks: {} });
    expect((await A.get(api(`/checklists/${opening.id}/history`))).body.map((r: any) => r.day)).toEqual(['2026-11-09', '2026-11-08']);
    expect((await B.get(api(`/checklists/${opening.id}/history`))).status).toBe(403);
  });

  it('onboarding: every new hire gets their own run; others can’t tick it for them', async () => {
    const ob = (await A.post(api('/checklists'), { title: 'Welcome aboard', kind: 'onboarding', items: [{ text: 'Read the SOP wiki' }, { text: 'Meet the team' }] })).body;
    const E = await t.signIn('e@example.com', 'Emad');
    await join(E, g.code);
    expect((await E.get(api('/checklists'))).body.find((l: any) => l.id === ob.id)).toMatchObject({ done: 0, total: 2 });
    await E.post(api(`/checklists/${ob.id}/items/i1/check`));
    const list = (await A.get(api('/checklists'))).body.find((l: any) => l.id === ob.id);
    expect(list.onboarding).toEqual([{ userId: E.user.id, done: 1, completedAt: null }]);
    expect((await B.get(api(`/checklists/${ob.id}/run?for=${E.user.id}`))).status).toBe(403);
    expect((await A.get(api(`/checklists/${ob.id}/run?for=${E.user.id}`))).body.run.checks.i1.by).toBe(E.user.id);
  });

  it('cross-group: another group’s checklist and roles → 404', async () => {
    const xg = (await X.get('/api/groups')).body[0];
    expect((await X.get(`/api/groups/${xg.id}/checklists/${opening.id}/run`)).status).toBe(404);
    expect((await X.post(`/api/groups/${xg.id}/checklists/${opening.id}/items/i1/check`, {})).status).toBe(404);
    expect((await X.del(`/api/groups/${xg.id}/roles/cashier`)).status).toBe(404);
  });
});
