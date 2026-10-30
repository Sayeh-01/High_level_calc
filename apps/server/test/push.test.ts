import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { pushTokens } from '../src/db/schema';
import { createExpoPushSender, EXPO_PUSH_URL, EXPO_RECEIPTS_URL, type FetchLike } from '../src/push';
import { join, makeGroup, setup, type TestApp } from './helpers';

const tok = (i: number) => `ExponentPushToken[tok-${i}]`;

describe('Expo push sender (B9 v1.0 #11)', () => {
  it('sends in chunks of up to 100 and reports DeviceNotRegistered tokens', async () => {
    const calls: any[][] = [];
    const fetchMock = vi.fn<FetchLike>(async (url, init) => {
      const batch = JSON.parse(init.body);
      calls.push(batch);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: batch.map((m: any) => (m.to === tok(7) || m.to === tok(150) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `t-${m.to}` })),
        }),
      };
    });
    const sender = createExpoPushSender(fetchMock);
    const messages = Array.from({ length: 250 }, (_, i) => ({ to: tok(i), title: 'hi' }));
    const res = await sender.send([...messages, { to: 'not-a-token', title: 'x' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(fetchMock.mock.calls.every(([url]) => url === EXPO_PUSH_URL)).toBe(true);
    expect(res.sent).toBe(248);
    expect(res.invalidTokens.sort()).toEqual(['not-a-token', tok(150), tok(7)].sort());
  });

  it('reads receipts and reports invalid tokens', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => ({ data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) }));
    const sender = createExpoPushSender(fetchMock);
    const res = await sender.receipts([{ id: 'a', token: tok(1) }, { id: 'b', token: tok(2) }]);
    expect(fetchMock.mock.calls[0][0]).toBe(EXPO_RECEIPTS_URL);
    expect(res.invalidTokens).toEqual([tok(2)]);
  });
});

describe('push pipeline: notification → job → Expo → prune', () => {
  let t: TestApp;
  const sent: any[] = [];
  beforeAll(async () => {
    const fetchMock: FetchLike = async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === EXPO_RECEIPTS_URL) return { ok: true, status: 200, json: async () => ({ data: { 'r-good': { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) };
      sent.push(...body);
      return { ok: true, status: 200, json: async () => ({ data: body.map((m: any) => (m.to.includes('dead') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'r-good' })) }) };
    };
    t = await setup({ push: createExpoPushSender(fetchMock) });
  });
  afterAll(() => t.close());

  it('assigning a task pushes to the assignee and prunes dead tokens', async () => {
    const a = await t.signIn('a@example.com', 'A');
    const b = await t.signIn('b@example.com', 'B');
    const g = await makeGroup(a, 'work');
    await join(b, g.code);
    await b.post('/api/me/push-tokens', { token: 'ExponentPushToken[good]', platform: 'ios' });
    await b.post('/api/me/push-tokens', { token: 'ExponentPushToken[dead]', platform: 'android' });
    await a.post(`/api/groups/${g.id}/tasks`, { title: 'Review PR', assigneeId: b.user.id });
    await t.runJobs();
    expect(sent.map((m) => m.to).sort()).toEqual(['ExponentPushToken[dead]', 'ExponentPushToken[good]']);
    expect(sent[0]).toMatchObject({ title: 'Review PR' });
    let tokens = await t.db.select().from(pushTokens).where(eq(pushTokens.userId, b.user.id));
    expect(tokens.map((x) => x.token)).toEqual(['ExponentPushToken[good]']);
    // receipts 15 minutes later report the other token dead too
    t.advance(16 * 60_000);
    await t.runJobs();
    tokens = await t.db.select().from(pushTokens).where(eq(pushTokens.userId, b.user.id));
    expect(tokens).toHaveLength(0);
  });

  it('a failing job retries with backoff and is marked dead after 5 attempts', async () => {
    const failing = await setup({ push: { send: async () => { throw new Error('expo down'); }, receipts: async () => ({ invalidTokens: [] }) } });
    const a = await failing.signIn('x@example.com');
    const b = await failing.signIn('y@example.com');
    const g = await makeGroup(a, 'work');
    await join(b, g.code);
    await b.post('/api/me/push-tokens', { token: 'ExponentPushToken[z]', platform: 'ios' });
    await a.post(`/api/groups/${g.id}/tasks`, { title: 'T', assigneeId: b.user.id });
    for (let i = 0; i < 6; i++) {
      await failing.runJobs();
      failing.advance(2 * 60 * 60_000);
    }
    const jobs = await failing.db.query.jobs.findMany({ where: (j, { eq }) => eq(j.kind, 'push') });
    expect(jobs[0]).toMatchObject({ status: 'dead', attempts: 5, lastError: 'expo down' });
    await failing.close();
  });
});
