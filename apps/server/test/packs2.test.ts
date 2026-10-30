import { moduleName } from '@circle/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formResponses, notifications } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client, D: Client, X: Client;

beforeAll(async () => {
  t = await setup();
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  D = await t.signIn('d@example.com', 'Dina');
  X = await t.signIn('x@example.com', 'Xavier');
});
afterAll(() => t.close());

describe('Faith & Charity, Club & Hobby and Volunteer templates', () => {
  it('come with their modules, role names and starters; Dues is called Donations where it should be', async () => {
    const faith = await makeGroup(A, 'faith', 'Ramadan khatma');
    expect(faith.group.modules).toEqual(expect.arrayContaining(['challenges', 'tasks', 'dues', 'events']));
    expect((await A.get(`/api/groups/${faith.id}/tasks`)).body[0]).toMatchObject({ title: 'Host iftar' });
    const club = await makeGroup(A, 'club', 'Book club');
    expect(club.group.modules).toEqual(expect.arrayContaining(['events', 'polls', 'challenges', 'lists']));
    const vol = await makeGroup(A, 'volunteer', 'Food bank');
    expect(vol.group.modules).toEqual(expect.arrayContaining(['events', 'tasks', 'dues', 'forms']));
    expect(moduleName('volunteer', 'dues', 'en')).toBe('Donations');
    expect(moduleName('faith', 'dues', 'ar')).toBe('التبرعات');
    expect(moduleName('roommates', 'dues', 'en')).toBe('Dues & Fees');
  });
});

describe('khatma (B9 v2.8): 30 parts across N members, the next round rotates them', () => {
  let g: { id: string; code: string };
  let cid: string;
  const url = (p = '') => `/api/groups/${g.id}/challenges/${cid}${p}`;
  const partsOf = (parts: any[], u: Client) => parts.filter((p) => p.userId === u.user.id).map((p) => p.part);

  it('splits 30 juz’ across 4 members in contiguous blocks and tells each one theirs', async () => {
    g = await makeGroup(A, 'faith', 'Khatma circle');
    for (const u of [B, C, D]) await join(u, g.code);
    const res = await A.post(`/api/groups/${g.id}/challenges`, { kind: 'split', title: 'Ramadan khatma', totalParts: 30, partLabel: 'Juz’', memberIds: [A, B, C, D].map((u) => u.user.id) });
    expect(res.status).toBe(200);
    cid = res.body.id;
    const { parts, challenge } = (await B.get(url())).body;
    expect(challenge.round).toBe(1);
    expect(parts).toHaveLength(30);
    expect([A, B, C, D].map((u) => partsOf(parts, u).length)).toEqual([8, 8, 7, 7]);
    expect(partsOf(parts, A)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const told = await t.db.select().from(notifications).where(eq(notifications.kind, 'challenge_parts'));
    expect(told.find((n) => n.userId === D.user.id)?.body).toBe('Yours: Juz’ 24–30');
  });

  it('only the reader (or a manager) marks a part done; the last part starts round 2 with the blocks rotated', async () => {
    let { parts } = (await A.get(url())).body;
    expect((await B.post(url('/parts/1/done'))).status).toBe(403);
    for (const p of parts) {
      const who = [A, B, C, D].find((u) => u.user.id === p.userId)!;
      const r = await who.post(url(`/parts/${p.part}/done`));
      expect(r.status).toBe(200);
      if (p.part === 30) expect(r.body).toEqual({ round: 2, nextRound: true });
    }
    const after = (await A.get(url())).body;
    expect(after.challenge.round).toBe(2);
    expect(after.completedRounds).toBe(1);
    parts = after.parts;
    expect(parts.every((p: any) => !p.doneAt)).toBe(true);
    expect(partsOf(parts, A)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(partsOf(parts, D)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('over 4 rounds every member reads all 30 parts exactly once', async () => {
    const seen: Record<string, number[]> = {};
    for (let round = 2; round <= 5; round++) {
      const { parts, challenge } = (await A.get(url())).body;
      expect(challenge.round).toBe(round);
      if (round <= 4) for (const u of [A, B, C, D]) (seen[u.user.id] ??= []).push(...partsOf(parts, u));
      if (round < 5) expect((await A.post(url('/next-round'))).body.round).toBe(round + 1);
    }
    // round 1 (already checked) + rounds 2–4
    seen[A.user.id].push(1, 2, 3, 4, 5, 6, 7, 8);
    seen[B.user.id].push(9, 10, 11, 12, 13, 14, 15, 16);
    seen[C.user.id].push(17, 18, 19, 20, 21, 22, 23);
    seen[D.user.id].push(24, 25, 26, 27, 28, 29, 30);
    for (const u of [A, B, C, D]) expect([...seen[u.user.id]].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect((await B.post(url('/next-round'))).status).toBe(403);
  });

  it('hand back, take over, reassign; a new member joins from the next round', async () => {
    const { parts } = (await A.get(url())).body; // round 5 = round 1 layout
    const bPart = partsOf(parts, B)[0];
    expect((await C.put(url(`/parts/${bPart}`), { userId: C.user.id })).status).toBe(403); // can't grab someone's part
    expect((await B.put(url(`/parts/${bPart}`), { userId: null })).status).toBe(200);
    expect((await C.put(url(`/parts/${bPart}`), { userId: C.user.id })).status).toBe(200);
    expect((await A.put(url(`/parts/${bPart + 1}`), { userId: D.user.id })).status).toBe(200);
    expect((await A.put(url(`/parts/${bPart + 1}`), { userId: X.user.id })).status).toBe(400);
    const now = (await A.get(url())).body.parts;
    expect(now.find((p: any) => p.part === bPart).userId).toBe(C.user.id);
    expect(now.find((p: any) => p.part === bPart + 1).userId).toBe(D.user.id);

    const E = await t.signIn('e@example.com', 'Emad');
    await join(E, g.code);
    expect((await E.post(url('/join'))).status).toBe(200);
    expect(partsOf((await E.get(url())).body.parts, E)).toEqual([]);
    await A.post(url('/next-round'));
    const five = (await E.get(url())).body.parts;
    expect([A, B, C, D, E].map((u) => partsOf(five, u).length)).toEqual([6, 6, 6, 6, 6]);
  });
});

describe('daily target with streaks (Club & Hobby)', () => {
  it('logs per day; the streak counts consecutive days at or over the target', async () => {
    const club = await makeGroup(A, 'club', 'Readers');
    await join(B, club.code);
    const ch = await A.post(`/api/groups/${club.id}/challenges`, { kind: 'tally', title: '20 pages a day', target: 20, unit: 'pages' });
    const u = (p = '') => `/api/groups/${club.id}/challenges/${ch.body.id}${p}`;
    t.setNow('2026-11-05T10:00:00Z');
    await A.post(u('/log'), { value: 10, day: '2026-11-02' });
    await A.post(u('/log'), { value: 25, day: '2026-11-03' });
    await A.post(u('/log'), { value: 22, day: '2026-11-04' });
    await A.post(u('/log'), { value: 30 }); // today
    await B.post(u('/log'), { value: 5 });
    expect((await A.post(u('/log'), { value: 5, day: '2026-11-09' })).status).toBe(400);
    const { streaks } = (await B.get(u())).body;
    expect(streaks.find((s: any) => s.userId === A.user.id)).toMatchObject({ streak: 3, today: 30 });
    expect(streaks.find((s: any) => s.userId === B.user.id)).toMatchObject({ streak: 0, today: 5 });
    // correcting a day replaces it
    await A.post(u('/log'), { value: 0, day: '2026-11-04' });
    expect((await A.get(u())).body.streaks.find((s: any) => s.userId === A.user.id).streak).toBe(1);
  });
});

describe('forms & signatures (B9 v2.8)', () => {
  let g: { id: string; code: string };
  let fid: string;
  const sig = { path: 'M10 40L40 20L70 45L100 15M120 30L160 32', width: 300, height: 120, name: 'Bassem Ali' };

  it('only coordinators create; a form for chosen people is invisible to everyone else', async () => {
    g = await makeGroup(A, 'volunteer', 'Food bank');
    for (const u of [B, C, D]) await join(u, g.code);
    const body = {
      title: 'Saturday trip consent',
      description: 'Bus leaves at 8',
      fields: [
        { id: 'emergency', label: 'Emergency phone', type: 'text', required: true },
        { id: 'consent', label: 'I agree to the trip rules', type: 'yes_no', required: true },
        { id: 'shirt', label: 'T-shirt size', type: 'choice', options: ['S', 'M', 'L'] },
      ],
      requireSignature: true,
      memberIds: [B.user.id, C.user.id],
    };
    expect((await B.post(`/api/groups/${g.id}/forms`, body)).status).toBe(403);
    expect((await A.post(`/api/groups/${g.id}/forms`, { ...body, fields: [{ id: 'x', label: 'X', type: 'choice' }] })).status).toBe(400);
    const res = await A.post(`/api/groups/${g.id}/forms`, body);
    expect(res.status).toBe(200);
    fid = res.body.id;
    expect((await D.get(`/api/groups/${g.id}/forms/${fid}`)).status).toBe(404);
    expect((await D.get(`/api/groups/${g.id}/forms`)).body).toEqual([]);
    expect((await B.get(`/api/groups/${g.id}/forms`)).body[0]).toMatchObject({ id: fid, forMe: true, responded: false });
  });

  it('answers are checked, the signature is required and must be a drawn path; it is stored and shown', async () => {
    const r = (p = '') => `/api/groups/${g.id}/forms/${fid}${p}`;
    const answers = { emergency: '+20 100 000 0000', consent: true, shirt: 'M' };
    expect((await B.post(r('/respond'), { answers })).body.error).toBe('signature_required');
    const bad = await B.post(r('/respond'), { answers: { consent: 'yes', shirt: 'XL' }, signature: sig });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.details).sort()).toEqual(['consent', 'emergency', 'shirt']);
    expect((await B.post(r('/respond'), { answers, signature: { ...sig, path: 'M10 10L20 20"/><script>alert(1)</script>' } })).status).toBe(400);
    expect((await D.post(r('/respond'), { answers, signature: sig })).status).toBe(404);
    const ok = await B.post(r('/respond'), { answers, signature: sig });
    expect(ok.status).toBe(200);
    // answering again replaces (one row)
    expect((await B.post(r('/respond'), { answers: { ...answers, shirt: 'L' }, signature: sig })).status).toBe(200);
    expect((await t.db.select().from(formResponses).where(eq(formResponses.formId, fid)))).toHaveLength(1);

    const mine = (await B.get(r())).body;
    expect(mine.mine).toMatchObject({ answers: { shirt: 'L', consent: true }, signature: sig });
    expect(mine.mine.signedAt).not.toBeNull();
    expect(mine.responses).toBeUndefined(); // members see only their own

    const all = (await A.get(r())).body;
    expect(all.responses).toHaveLength(1);
    expect(all.responses[0].signature).toEqual(sig);
    expect(all).toMatchObject({ expected: 2, missing: [C.user.id], tallies: { consent: { true: 1 }, shirt: { L: 1 } } });
    const sheet = (await A.get(r('/sheet'))).body.html as string;
    expect(sheet).toContain(`<path d="${sig.path}"`);
    expect(sheet).toContain('Bassem Ali');
    expect(sheet).toContain('viewBox="0 0 300 120"');
    expect((await B.get(r('/sheet'))).status).toBe(403);
  });

  it('a closed form takes no more answers', async () => {
    const r = (p = '') => `/api/groups/${g.id}/forms/${fid}${p}`;
    expect((await B.post(r('/close'))).status).toBe(403);
    expect((await A.post(r('/close'))).status).toBe(200);
    expect((await C.post(r('/respond'), { answers: { emergency: '1', consent: true }, signature: sig })).status).toBe(409);
  });

  it('cross-group: another group’s challenge and form ids → 404', async () => {
    const xg = await makeGroup(X, 'volunteer', 'X team');
    const faith = (await A.get('/api/groups')).body.find((x: any) => x.name === 'Khatma circle');
    const khatma = (await A.get(`/api/groups/${faith.id}/challenges`)).body[0];
    for (const [m, p, b] of [
      ['GET', `/api/groups/${xg.id}/forms/${fid}`],
      ['POST', `/api/groups/${xg.id}/forms/${fid}/respond`, { answers: {}, signature: sig }],
      ['GET', `/api/groups/${xg.id}/forms/${fid}/sheet`],
      ['GET', `/api/groups/${xg.id}/challenges/${khatma.id}`],
      ['POST', `/api/groups/${xg.id}/challenges/${khatma.id}/parts/1/done`, {}],
      ['PUT', `/api/groups/${xg.id}/challenges/${khatma.id}/parts/1`, { userId: X.user.id }],
    ] as [string, string, unknown?][])
      expect((await X.req(m, p, b)).status, `${m} ${p}`).toBe(404);
  });
});
