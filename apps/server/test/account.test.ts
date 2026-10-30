import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

describe('account deletion (B9 v1.0 #10)', () => {
  it('removes profile and memberships; owned groups pass to the oldest Admin or are deleted when empty', async () => {
    const owner = await t.signIn('leaving@example.com', 'Leaving');
    const m1 = await t.signIn('m1@example.com', 'First member');
    const adminOld = await t.signIn('admin-old@example.com', 'Old admin');
    const adminNew = await t.signIn('admin-new@example.com', 'New admin');

    const shared = await makeGroup(owner, 'roommates', 'Shared');
    await join(m1, shared.code);
    await join(adminOld, shared.code);
    await join(adminNew, shared.code);
    await owner.patch(`/api/groups/${shared.id}/members/${adminOld.user.id}`, { role: 'admin' });
    await owner.patch(`/api/groups/${shared.id}/members/${adminNew.user.id}`, { role: 'admin' });

    const membersOnly = await makeGroup(owner, 'family', 'Members only');
    await join(m1, membersOnly.code);

    const alone = await makeGroup(owner, 'custom', 'Alone', { modules: ['tasks'] });

    const other = await makeGroup(m1, 'study', 'Not mine');
    await join(owner, other.code);
    await owner.post(`/api/groups/${shared.id}/expenses`, { title: 'History', amount: 300, payerId: owner.user.id, split: { kind: 'equal', members: [owner.user.id, m1.user.id] } });

    expect((await owner.del('/api/me')).status).toBe(200);

    // profile and session are gone
    expect((await owner.get('/api/me')).status).toBe(401);
    // the oldest Admin (not the oldest member) owns the shared group
    const s = await adminOld.get(`/api/groups/${shared.id}`);
    expect(s.body.me.role).toBe('owner');
    expect(s.body.members.map((m: any) => m.displayName)).not.toContain('Leaving');
    // no admin → the oldest member
    expect((await m1.get(`/api/groups/${membersOnly.id}`)).body.me.role).toBe('owner');
    // nobody else → deleted
    const remaining = await t.db.query.groups.findFirst({ where: (g, { eq }) => eq(g.id, alone.id) });
    expect(remaining).toBeUndefined();
    // membership elsewhere removed
    const o = await m1.get(`/api/groups/${other.id}`);
    expect(o.body.members).toHaveLength(1);
    // money history stays intact for the others
    const exp = await m1.get(`/api/groups/${shared.id}/expenses`);
    expect(exp.body).toHaveLength(1);
  });
});

describe('profile', () => {
  it('updates language, digits and timezone; rejects unknown timezones', async () => {
    const u = await t.signIn('p@example.com');
    const ok = await u.patch('/api/me', { language: 'ar', digits: 'arab', timezone: 'Asia/Riyadh', name: 'كريم' });
    expect(ok.body).toMatchObject({ language: 'ar', digits: 'arab', timezone: 'Asia/Riyadh', name: 'كريم' });
    expect((await u.patch('/api/me', { timezone: 'Mars/Olympus' })).status).toBe(400);
    const exp = await u.get('/api/me/export');
    expect(exp.body.profile.email).toBe('p@example.com');
  });
});
