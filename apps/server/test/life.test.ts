import { count } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeModel } from '../src/ai';
import { cards, events, listItems, messages, tasks } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, X: Client;
let fam: { id: string; code: string };
let other: { id: string; code: string };
let fake: ReturnType<typeof createFakeModel>;
let nextCapture: (prompt: string) => unknown = () => ({});

beforeAll(async () => {
  fake = createFakeModel({
    capture: (p) => nextCapture(p),
    chat_items: (p) => {
      const ctx = JSON.parse(/<context>([\s\S]*)<\/context>/.exec(p)![1]);
      return { items: [{ kind: 'event', title: 'Play Thursday', when: '2026-11-05T19:00:00Z', sourceMessageId: ctx.messages[0].id }, { kind: 'task', title: 'made up', when: null, sourceMessageId: 'not-a-real-message' }] };
    },
    catchup: () => '• Friday lunch at grandma’s\n• Internet bill paid',
    quiz: () => ({ cards: [{ front: 'det(I)?', back: '1' }, { front: 'rank(0)?', back: '0' }] }),
  });
  t = await setup({ ai: fake });
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  X = await t.signIn('x@example.com', 'Xavier');
  fam = await makeGroup(A, 'family', 'Home');
  await join(B, fam.code);
  other = await makeGroup(X, 'family', 'Secret X group');
});
afterAll(() => t.close());

describe('meal plan → groceries (B9 v1.4)', () => {
  it('merges the same ingredient and unit into the grocery list, and merges again on re-run', async () => {
    await A.post(`/api/groups/${fam.id}/meals`, { day: '2026-11-02', slot: 'lunch', title: 'Koshary', ingredients: [{ name: 'Rice', qty: 500, unit: 'g' }, { name: 'Lentils', qty: 250, unit: 'g' }, { name: 'Onions', qty: 2 }] });
    await A.post(`/api/groups/${fam.id}/meals`, { day: '2026-11-04', slot: 'dinner', title: 'Mahshi', ingredients: [{ name: 'rice', qty: 300, unit: 'grams' }, { name: 'Onions', qty: 1 }, { name: 'Rice', qty: 1, unit: 'kg' }] });
    await A.post(`/api/groups/${fam.id}/meals`, { day: '2026-11-20', slot: 'dinner', title: 'Not this week', ingredients: [{ name: 'Fish', qty: 1, unit: 'kg' }] });
    const res = await B.post(`/api/groups/${fam.id}/meals/to-list`, { from: '2026-11-02', to: '2026-11-08' });
    expect(res.body).toMatchObject({ ingredients: 4 });
    const list = await A.get(`/api/groups/${fam.id}/lists/${res.body.listId}`);
    const lines = Object.fromEntries(list.body.items.filter((i: any) => !i.checked).map((i: any) => [`${i.title}`.toLowerCase() + '|' + (i.qty ?? ''), true]));
    expect(lines).toHaveProperty('rice|800 g');
    expect(lines).toHaveProperty('rice|1 kg');
    expect(lines).toHaveProperty('lentils|250 g');
    expect(lines).toHaveProperty('onions|3');
    expect(Object.keys(lines).some((k) => k.startsWith('fish'))).toBe(false);
    // running it again updates the same lines instead of duplicating them
    const again = await B.post(`/api/groups/${fam.id}/meals/to-list`, { from: '2026-11-02', to: '2026-11-08', listId: res.body.listId });
    expect(again.body).toMatchObject({ added: 0, updated: 4 });
    const list2 = await A.get(`/api/groups/${fam.id}/lists/${res.body.listId}`);
    expect(list2.body.items.find((i: any) => i.title === 'Rice' && i.qty === '1600 g')).toBeTruthy();
  });
});

async function counts() {
  const c = async (tbl: any) => (await t.db.select({ n: count() }).from(tbl))[0].n;
  return { tasks: await c(tasks), events: await c(events), cards: await c(cards), messages: await c(messages), items: await c(listItems) };
}

describe('AI drafts (B9 v1.4)', () => {
  it('AI endpoints only return drafts; nothing is saved', async () => {
    await B.post(`/api/groups/${fam.id}/messages`, { body: "Let's play football Thursday 9pm?" });
    const page = await A.post(`/api/groups/${fam.id}/pages`, { title: 'Algebra', body: 'det(I) is 1.' }).catch(() => null);
    void page;
    nextCapture = () => ({ kind: 'task', title: 'Pay internet', groupId: fam.id, assigneeIds: [B.user.id], when: '2026-11-06T18:00:00Z', listId: null });
    const before = await counts();
    const cap = await A.post('/api/ai/capture', { text: 'Remind Bassem to pay internet Friday' });
    expect(cap.body).toEqual({ saved: false, draft: { kind: 'task', title: 'Pay internet', groupId: fam.id, assigneeIds: [B.user.id], when: '2026-11-06T18:00:00.000Z', listId: null } });
    const items = await A.post(`/api/groups/${fam.id}/ai/chat-items`);
    expect(items.body.items).toHaveLength(1); // the made-up source message is dropped
    expect(items.body.items[0]).toMatchObject({ kind: 'event', title: 'Play Thursday' });
    const catchup = await A.post(`/api/groups/${fam.id}/ai/catchup`);
    expect(catchup.body.unread).toBe(1);
    expect(catchup.body.summary).toContain('Friday lunch');
    await A.put(`/api/groups/${fam.id}/modules`, { modules: ['chat', 'tasks', 'lists', 'flashcards', 'notes', 'meals', 'memories', 'events'] });
    const quiz = await A.post(`/api/groups/${fam.id}/ai/quiz`, { text: 'det(I) = 1. rank of the zero matrix is 0.' });
    expect(quiz.body.cards).toHaveLength(2);
    expect(await counts()).toEqual(before);
  });

  it('with the fake model, quick capture can’t target a group the user isn’t in', async () => {
    const otherList = (await X.get(`/api/groups/${other.id}/lists`)).body[0].id;
    nextCapture = () => ({ kind: 'list_item', title: 'Milk', groupId: other.id, assigneeIds: [X.user.id], when: null, listId: otherList });
    const res = await A.post('/api/ai/capture', { text: 'add milk to Secret X group' });
    expect(res.body.draft).toMatchObject({ groupId: null, assigneeIds: [], listId: null });
    // a real group of mine, but an assignee and a list from elsewhere
    nextCapture = () => ({ kind: 'list_item', title: 'Milk', groupId: fam.id, assigneeIds: [X.user.id, B.user.id], when: 'not a date', listId: otherList });
    const res2 = await A.post('/api/ai/capture', { text: 'milk' });
    expect(res2.body.draft).toMatchObject({ groupId: fam.id, assigneeIds: [B.user.id], listId: null, when: null });
    // the model never saw the other group
    const prompt = fake.calls.filter((x) => x.task === 'capture').at(-1)!.prompt;
    expect(prompt).not.toContain('Secret X group');
    expect(prompt).not.toContain(other.id);
    expect(prompt).toContain('Home');
  });

  it('AI is off without a key (503) and never available to Child accounts (403)', async () => {
    const plain = await setup();
    const u = await plain.signIn('u@example.com');
    expect((await u.post('/api/ai/capture', { text: 'x' })).status).toBe(503);
    expect(await (await plain.app.request('/api/config')).json()).toMatchObject({ ai: false });
    await plain.close();
    const kid = await A.post(`/api/groups/${fam.id}/children`, { name: 'Lina', pin: '1234' });
    const res = await t.raw('POST', '/api/auth/child/sign-in', { childId: kid.body.id, pin: '1234' });
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect((await t.raw('POST', '/api/ai/capture', { text: 'x' }, cookie)).status).toBe(403);
    expect((await t.raw('POST', `/api/groups/${fam.id}/ai/catchup`, {}, cookie)).status).toBe(403);
  });

  it('a refusal or invalid model output is reported, not saved', async () => {
    nextCapture = () => ({ kind: 'nonsense' });
    expect((await A.post('/api/ai/capture', { text: 'x' })).status).toBe(422);
  });
});

describe('memories and the yearly book', () => {
  it('timeline + book HTML (embedded photos, RTL in Arabic, only that year, date order)', async () => {
    const up = await A.post(`/api/groups/${fam.id}/files`, { mime: 'image/png', size: 4 });
    await t.app.request(up.body.uploadUrl, { method: 'PUT', body: new Uint8Array([137, 80, 78, 71]) });
    await A.post(`/api/groups/${fam.id}/memories`, { day: '2026-07-10', text: 'Beach day in Sahel', photoFileIds: [up.body.fileId] });
    await B.post(`/api/groups/${fam.id}/memories`, { day: '2026-03-21', text: 'Mother’s day <surprise>' });
    await A.post(`/api/groups/${fam.id}/memories`, { day: '2025-12-31', text: 'Last year' });
    const otherFile = await X.post(`/api/groups/${other.id}/files`, { mime: 'image/png', size: 4 });
    expect((await A.post(`/api/groups/${fam.id}/memories`, { day: '2026-01-01', photoFileIds: [otherFile.body.fileId] })).status).toBe(400);
    const book = await A.get(`/api/groups/${fam.id}/memories/book?year=2026&lang=ar`);
    expect(book.body.count).toBe(2);
    const html: string = book.body.html;
    expect(html).toContain('dir="rtl"');
    expect(html.indexOf('Mother')).toBeLessThan(html.indexOf('Beach day'));
    expect(html).toContain('data:image/png;base64,iVBORw==');
    expect(html).toContain('&lt;surprise&gt;');
    expect(html).not.toContain('Last year');
    const timeline = await B.get(`/api/groups/${fam.id}/memories?year=2026`);
    expect(timeline.body.map((m: any) => m.day)).toEqual(['2026-07-10', '2026-03-21']);
  });

  it('cross-group: meals and memories of another group → 404', async () => {
    const meal = await X.post(`/api/groups/${other.id}/meals`, { day: '2026-11-02', slot: 'lunch', title: 'X meal' });
    const mem = await X.post(`/api/groups/${other.id}/memories`, { day: '2026-11-02', text: 'X memory' });
    expect((await A.del(`/api/groups/${fam.id}/meals/${meal.body.id}`)).status).toBe(404);
    expect((await A.del(`/api/groups/${fam.id}/memories/${mem.body.id}`)).status).toBe(404);
    const xList = (await X.get(`/api/groups/${other.id}/lists`)).body[0].id;
    expect((await A.post(`/api/groups/${fam.id}/meals/to-list`, { from: '2026-11-01', to: '2026-11-08', listId: xList })).status).toBe(400);
  });
});
