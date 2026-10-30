import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groups, jobs, messages, notifications, tasks } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, X: Client;
let g: { id: string; code: string; group: any };
const api = (p: string) => `/api/groups/${g.id}${p}`;

beforeAll(async () => {
  t = await setup();
  t.setNow('2026-11-08T05:00:00Z'); // Sunday 07:00 in Cairo
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  X = await t.signIn('x@example.com', 'Xavier');
  g = await makeGroup(A, 'work', 'Product team');
  await join(B, g.code);
  await join(C, g.code);
});
afterAll(() => t.close());

describe('Work Team pack', () => {
  it('the Work template now has stand-ups, meeting notes and leave', () => {
    expect(g.group.modules).toEqual(expect.arrayContaining(['tasks', 'standups', 'meetings', 'leave']));
  });

  it('board: to do → doing → done; only the assignee, the creator or a manager moves a task', async () => {
    const task = await A.post(api('/tasks'), { title: 'Write the spec', assigneeId: B.user.id });
    expect((await C.post(api(`/tasks/${task.body.id}/stage`), { stage: 'doing' })).status).toBe(403);
    expect((await B.post(api(`/tasks/${task.body.id}/stage`), { stage: 'doing' })).status).toBe(200);
    let board = (await C.get(api('/board'))).body;
    expect(board.doing.map((x: any) => x.id)).toEqual([task.body.id]);
    expect(board.todo.find((x: any) => x.id === task.body.id)).toBeUndefined();
    await B.post(api(`/tasks/${task.body.id}/complete`));
    board = (await C.get(api('/board'))).body;
    expect(board.done.map((x: any) => x.id)).toContain(task.body.id);
    expect(board.doing).toEqual([]);
    expect((await B.post(api(`/tasks/${task.body.id}/stage`), { stage: 'todo' })).status).toBe(409);
  });
});

describe('async stand-ups', () => {
  it('reminds who hasn’t answered at 09:30, posts a summary to chat at 12:00, skips the weekend (Fri/Sat in Egypt)', async () => {
    // Carla is on leave today
    expect((await C.post(api('/time-off'), { startDay: '2026-11-08', endDay: '2026-11-08', kind: 'sick' })).body.status).toBe('approved');
    expect((await A.get(api('/standups'))).body).toMatchObject({ day: '2026-11-08', workDay: true, away: [C.user.id] });
    await A.put(api('/standups/me'), { yesterday: 'Planning', today: 'Ship the login fix', blockers: 'Waiting for design' });
    t.setNow('2026-11-08T07:30:00Z');
    await t.runJobs();
    const reminded = (await t.db.select().from(notifications).where(eq(notifications.kind, 'standup'))).map((n) => n.userId);
    expect(reminded).toEqual([B.user.id]);
    t.setNow('2026-11-08T10:00:00Z');
    await t.runJobs();
    const posted = (await t.db.select().from(messages).where(eq(messages.groupId, g.id))).filter((m) => m.userId === 'system');
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toContain('Amal: Ship the login fix — ⛔ Waiting for design');
    expect(posted[0].body).toContain('Not in yet: Bassem');
    expect(posted[0].body).toContain('Off: Carla');
    // the cycle continues on work days only: Thursday's summary is followed by Sunday's reminder
    for (const day of ['09', '10', '11', '12']) {
      t.setNow(`2026-11-${day}T10:00:00Z`);
      await t.runJobs();
    }
    const keys = (await t.db.select().from(jobs)).map((j) => j.dedupeKey).filter((k) => k?.startsWith(`standup:${g.id}`));
    expect(keys).toContain(`standup:${g.id}:2026-11-15:remind`);
    expect(keys.some((k) => k!.includes('2026-11-13') || k!.includes('2026-11-14'))).toBe(false);
    expect((await t.db.select().from(messages).where(eq(messages.groupId, g.id))).filter((m) => m.userId === 'system')).toHaveLength(5);
  });
});

describe('meeting notes → tasks', () => {
  it('action items are read from the notes and become tasks once; editing keeps the ones already made', async () => {
    t.setNow('2026-11-09T08:00:00Z');
    const m = await A.post(api('/meetings'), { title: 'Weekly sync', day: '2026-11-09', notes: '- Revenue up\n- [ ] Send the deck @Bassem by 2026-11-12\nTODO: update roadmap' });
    expect(m.body.actionItems).toEqual([
      { title: 'Send the deck', assigneeId: B.user.id, dueDay: '2026-11-12', taskId: null },
      { title: 'update roadmap', assigneeId: null, dueDay: null, taskId: null },
    ]);
    expect((await A.post(api(`/meetings/${m.body.id}/tasks`))).body.created).toBe(2);
    expect((await A.post(api(`/meetings/${m.body.id}/tasks`))).body.created).toBe(0);
    const deck = (await t.db.select().from(tasks).where(eq(tasks.title, 'Send the deck')))[0];
    expect(deck).toMatchObject({ assigneeId: B.user.id, groupId: g.id });
    expect(deck.dueAt!.toISOString()).toBe('2026-11-12T15:00:00.000Z'); // 17:00 Cairo
    const edited = await A.patch(api(`/meetings/${m.body.id}`), { notes: '- [ ] Send the deck @Bassem by 2026-11-12\n- [ ] Book a room @Carla' });
    expect(edited.body.actionItems.map((i: any) => [i.title, !!i.taskId])).toEqual([
      ['Send the deck', true],
      ['update roadmap', true],
      ['Book a room', false],
    ]);
  });
});

describe('leave calendar', () => {
  it('Work Teams book leave straight away; overlaps and backwards ranges are refused', async () => {
    expect((await B.post(api('/time-off'), { startDay: '2026-11-20', endDay: '2026-11-24' })).body.status).toBe('approved');
    expect((await B.post(api('/time-off'), { startDay: '2026-11-24', endDay: '2026-11-26' })).status).toBe(409);
    expect((await B.post(api('/time-off'), { startDay: '2026-11-26', endDay: '2026-11-25' })).status).toBe(400);
    const list = (await C.get(api('/time-off?from=2026-11-01&to=2026-11-30'))).body;
    expect(list.map((l: any) => l.userId)).toEqual(expect.arrayContaining([B.user.id, C.user.id]));
  });

  it('where the group asks for approval, requests wait for a manager and stay private until approved', async () => {
    await t.db.update(groups).set({ settings: { ...g.group.settings, leaveApproval: true } }).where(eq(groups.id, g.id));
    const req = await C.post(api('/time-off'), { startDay: '2026-12-01', endDay: '2026-12-03', kind: 'vacation', note: 'Family trip' });
    expect(req.body.status).toBe('pending');
    expect((await t.db.select().from(notifications).where(eq(notifications.kind, 'leave_request'))).map((n) => n.userId)).toEqual([A.user.id]);
    expect((await B.get(api('/time-off?from=2026-12-01&to=2026-12-31'))).body).toEqual([]);
    expect((await A.get(api('/time-off?from=2026-12-01&to=2026-12-31'))).body).toHaveLength(1);
    expect((await B.post(api(`/time-off/${req.body.id}/approve`))).status).toBe(403);
    expect((await A.post(api(`/time-off/${req.body.id}/approve`))).status).toBe(200);
    expect((await A.post(api(`/time-off/${req.body.id}/approve`))).status).toBe(409);
    expect((await B.get(api('/time-off?from=2026-12-01&to=2026-12-31'))).body[0]).toMatchObject({ status: 'approved', userId: C.user.id });
  });

  it('cross-group: another group’s task, meeting and leave ids → 404', async () => {
    const xg = await makeGroup(X, 'work', 'X team');
    const task = (await t.db.select().from(tasks).where(eq(tasks.groupId, g.id)))[0];
    const meeting = (await A.get(api('/meetings'))).body[0];
    const leave = (await A.get(api('/time-off?from=2026-11-01&to=2026-12-31'))).body[0];
    for (const [m, p, b] of [
      ['POST', `/api/groups/${xg.id}/tasks/${task.id}/stage`, { stage: 'doing' }],
      ['PATCH', `/api/groups/${xg.id}/meetings/${meeting.id}`, { notes: 'x' }],
      ['POST', `/api/groups/${xg.id}/meetings/${meeting.id}/tasks`, {}],
      ['POST', `/api/groups/${xg.id}/time-off/${leave.id}/approve`, {}],
      ['DELETE', `/api/groups/${xg.id}/time-off/${leave.id}`],
    ] as [string, string, unknown?][])
      expect((await X.req(m, p, b)).status, `${m} ${p}`).toBe(404);
  });
});
