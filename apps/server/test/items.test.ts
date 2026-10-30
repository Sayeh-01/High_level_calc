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
  const g = await makeGroup(A, 'family', 'Home');
  gid = g.id;
  await join(B, g.code);
  await join(C, g.code);
});
afterAll(() => t.close());

describe('tasks & chores', () => {
  it('rotation A → B → C → A on completion, skipping members marked away', async () => {
    const task = await A.post(`/api/groups/${gid}/tasks`, {
      title: 'Dishes',
      rotation: [A.user.id, B.user.id, C.user.id],
      dueAt: '2026-11-02T18:00:00+02:00',
      rrule: 'FREQ=DAILY',
      points: 3,
    });
    expect(task.body.assigneeId).toBe(A.user.id);
    const done1 = await A.post(`/api/groups/${gid}/tasks/${task.body.id}/complete`);
    expect(done1.body).toMatchObject({ assigneeId: B.user.id, status: 'open', dueAt: '2026-11-03T16:00:00.000Z' });
    await C.patch(`/api/groups/${gid}/members/${C.user.id}`, { away: true });
    t.advance(1000);
    const done2 = await B.post(`/api/groups/${gid}/tasks/${task.body.id}/complete`);
    expect(done2.body.assigneeId).toBe(A.user.id);
    await C.patch(`/api/groups/${gid}/members/${C.user.id}`, { away: false });
    const detail = await A.get(`/api/groups/${gid}/tasks/${task.body.id}`);
    expect(detail.body.completions.map((x: any) => [x.userId, x.points])).toEqual([[B.user.id, 3], [A.user.id, 3]]);
  });

  it('one-off task: complete with photo proof, comment, notify assignee', async () => {
    const task = await A.post(`/api/groups/${gid}/tasks`, { title: 'Fix the tap', assigneeId: B.user.id });
    const inbox = await B.get('/api/me/inbox');
    expect(inbox.body[0]).toMatchObject({ kind: 'task_assigned', title: 'Fix the tap' });
    const up = await B.post(`/api/groups/${gid}/files`, { mime: 'image/jpeg', size: 3 });
    const put = await t.app.request(up.body.uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2, 3]) });
    expect(put.status).toBe(200);
    const done = await B.post(`/api/groups/${gid}/tasks/${task.body.id}/complete`, { photoFileId: up.body.fileId });
    expect(done.body.status).toBe('done');
    const file = await A.req('GET', `/api/groups/${gid}/files/${up.body.fileId}`);
    expect(file.status).toBe(200);
    await A.post(`/api/groups/${gid}/tasks/${task.body.id}/comments`, { body: 'Thanks!' });
    const detail = await A.get(`/api/groups/${gid}/tasks/${task.body.id}`);
    expect(detail.body.comments[0].body).toBe('Thanks!');
    expect(detail.body.completions[0].photoFileId).toBe(up.body.fileId);
  });

  it('due job notifies the assignee once at the due time', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    await A.post(`/api/groups/${gid}/tasks`, { title: 'Pay internet', assigneeId: C.user.id, dueAt: '2026-11-02T12:00:00Z' });
    t.setNow('2026-11-02T12:00:00Z');
    await t.runJobs();
    await t.runJobs();
    const inbox = await C.get('/api/me/inbox');
    expect(inbox.body.filter((n: any) => n.kind === 'task_due' && n.title === 'Pay internet')).toHaveLength(1);
  });

  it('members can only edit their own tasks; admins can edit any', async () => {
    const task = await B.post(`/api/groups/${gid}/tasks`, { title: 'Mine' });
    expect((await C.patch(`/api/groups/${gid}/tasks/${task.body.id}`, { title: 'hijack' })).status).toBe(403);
    expect((await A.patch(`/api/groups/${gid}/tasks/${task.body.id}`, { title: 'ok' })).status).toBe(200);
  });

  it('Today lists my overdue / due-this-week tasks', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    await A.post(`/api/groups/${gid}/tasks`, { title: 'Overdue', assigneeId: B.user.id, dueAt: '2026-11-01T10:00:00Z' });
    await A.post(`/api/groups/${gid}/tasks`, { title: 'Next month', assigneeId: B.user.id, dueAt: '2026-12-20T10:00:00Z' });
    const today = await B.get('/api/me/today');
    const titles = today.body.tasks.map((x: any) => x.title);
    expect(titles).toContain('Overdue');
    expect(titles).not.toContain('Next month');
    expect(today.body.tasks.find((x: any) => x.title === 'Overdue')).toMatchObject({ overdue: true, groupName: 'Home' });
  });
});

describe('lists', () => {
  it('check / uncheck records who checked it', async () => {
    const list = await A.post(`/api/groups/${gid}/lists`, { title: 'Trip' });
    const item = await A.post(`/api/groups/${gid}/lists/${list.body.id}/items`, { title: 'Sunscreen', qty: '2' });
    const checked = await B.patch(`/api/groups/${gid}/lists/${list.body.id}/items/${item.body.id}`, { checked: true });
    expect(checked.body).toMatchObject({ checked: true, checkedBy: B.user.id });
    const un = await C.patch(`/api/groups/${gid}/lists/${list.body.id}/items/${item.body.id}`, { checked: false });
    expect(un.body).toMatchObject({ checked: false, checkedBy: null });
    const lists = await A.get(`/api/groups/${gid}/lists`);
    expect(lists.body.find((l: any) => l.id === list.body.id)).toMatchObject({ total: 1, open: 1 });
  });
});

describe('polls', () => {
  it('single choice, results, closing', async () => {
    const p = await A.post(`/api/groups/${gid}/polls`, { question: 'Dinner?', options: ['Koshary', 'Pizza'] });
    const [k, pz] = p.body.options.map((o: any) => o.id);
    expect((await B.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [k, pz] })).status).toBe(400);
    await B.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [k] });
    await C.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [k] });
    const changed = await C.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [pz] });
    expect(changed.body.options.map((o: any) => o.votes)).toEqual([1, 1]);
    expect(changed.body.options[0].voters).toEqual([B.user.id]);
    await A.post(`/api/groups/${gid}/polls/${p.body.id}/close`);
    expect((await B.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [pz] })).status).toBe(409);
  });

  it('multi choice and anonymous hides voters; deadline closes it', async () => {
    const p = await A.post(`/api/groups/${gid}/polls`, { question: 'Which days?', options: ['Thu', 'Fri', 'Sat'], multi: true, anonymous: true, closesAt: '2026-11-03T00:00:00Z' });
    const ids = p.body.options.map((o: any) => o.id);
    t.setNow('2026-11-02T09:00:00Z');
    const v = await B.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [ids[0], ids[2]] });
    expect(v.body.options.map((o: any) => o.votes)).toEqual([1, 0, 1]);
    expect(v.body.options.every((o: any) => o.voters.length === 0)).toBe(true);
    t.setNow('2026-11-03T00:00:01Z');
    expect((await C.post(`/api/groups/${gid}/polls/${p.body.id}/vote`, { optionIds: [ids[1]] })).status).toBe(409);
  });
});

describe('chat & announcements', () => {
  it('text, reply, @mention notifies; only admins pin; Today shows unread announcements', async () => {
    const m1 = await B.post(`/api/groups/${gid}/messages`, { body: 'Who is home tonight?' });
    const m2 = await C.post(`/api/groups/${gid}/messages`, { body: '@A I am', replyToId: m1.body.id, mentions: [A.user.id] });
    expect(m2.body.replyToId).toBe(m1.body.id);
    const inbox = await A.get('/api/me/inbox');
    expect(inbox.body.some((n: any) => n.kind === 'mention')).toBe(true);
    expect((await B.post(`/api/groups/${gid}/messages/${m1.body.id}/pin`)).status).toBe(403);
    expect((await B.post(`/api/groups/${gid}/messages`, { body: 'x', pinned: true })).status).toBe(403);
    const ann = await A.post(`/api/groups/${gid}/messages`, { body: 'Friday lunch at grandma’s', pinned: true });
    let today = await B.get('/api/me/today');
    expect(today.body.announcements.map((a: any) => a.id)).toContain(ann.body.id);
    await B.post(`/api/groups/${gid}/announcements/${ann.body.id}/read`, {});
    today = await B.get('/api/me/today');
    expect(today.body.announcements.map((a: any) => a.id)).not.toContain(ann.body.id);
    const list = await A.get(`/api/groups/${gid}/announcements`);
    expect(list.body[0]).toMatchObject({ readCount: 1 });
  });

  it('unread counts per group drop after reading', async () => {
    t.advance(1000);
    await B.post(`/api/groups/${gid}/messages`, { body: 'ping' });
    let groups = await C.get('/api/groups');
    expect(groups.body.find((g: any) => g.id === gid).unread).toBeGreaterThan(0);
    await C.get(`/api/groups/${gid}/messages`);
    groups = await C.get('/api/groups');
    expect(groups.body.find((g: any) => g.id === gid).unread).toBe(0);
  });

  it('activity feed records changes', async () => {
    const feed = await A.get(`/api/groups/${gid}/activity`);
    const verbs = new Set(feed.body.map((a: any) => `${a.verb}:${a.entity}`));
    for (const v of ['created:task', 'completed:task', 'created:list', 'checked:list_item', 'voted:poll', 'announced:message', 'joined:member']) expect(verbs).toContain(v);
  });
});
