import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeModel } from '../src/ai';
import { emergencyCards, files, jobs, medDoses, notifications, tasks, vaultDocs } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client, C: Client;
let g: { id: string; code: string; group: any };

beforeAll(async () => {
  t = await setup({ ai: createFakeModel({ ocr: () => 'Insurance policy number 77-123-ABC valid until 2027' }) });
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  C = await t.signIn('c@example.com', 'Carla');
  g = await makeGroup(A, 'care', 'Care for Dad');
  await join(B, g.code);
  await join(C, g.code);
});
afterAll(() => t.close());

const expiryAlerts = async (docId: string) =>
  (await t.db.select().from(notifications).where(and(eq(notifications.kind, 'vault_expiry'), eq(notifications.userId, A.user.id)))).filter((n: any) => n.data.docId === docId);

describe('Care Circle template', () => {
  it('comes with care modules and role names', async () => {
    expect(g.group.modules).toEqual(expect.arrayContaining(['meds', 'vault', 'safety', 'events', 'tasks']));
    const detail = await A.get(`/api/groups/${g.id}`);
    expect(detail.body.me.role).toBe('owner');
    const tasksList = await A.get(`/api/groups/${g.id}/tasks`);
    expect(tasksList.body[0].title).toBe('Drive to the doctor');
  });
});

describe('vault expiry alerts (B9 v1.5)', () => {
  it('fire exactly once each at 60, 30 and 7 days (09:00 group time); 60 days also creates a renew task', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    const folder = await A.post(`/api/groups/${g.id}/vault/folders`, { name: 'Insurance', access: 'all' });
    const doc = await A.post(`/api/groups/${g.id}/vault/folders/${folder.body.id}/docs`, { title: 'Health insurance', expiresOn: '2027-02-15', notes: 'Card in the blue folder' });
    const checkpoints: [string, number][] = [
      ['2026-12-17T06:59:00Z', 0], // 60 days before at 09:00 Cairo = 07:00Z
      ['2026-12-17T07:00:00Z', 1],
      ['2027-01-15T07:00:00Z', 1],
      ['2027-01-16T07:00:00Z', 2], // 30 days before
      ['2027-02-08T07:00:00Z', 3], // 7 days before
      ['2027-03-01T07:00:00Z', 3],
    ];
    for (const [at, n] of checkpoints) {
      t.setNow(at);
      await t.runJobs();
      await t.runJobs(); // running twice must not duplicate
      expect((await expiryAlerts(doc.body.id)).length, at).toBe(n);
    }
    expect((await expiryAlerts(doc.body.id)).map((x: any) => x.data.days)).toEqual(expect.arrayContaining([60, 30, 7]));
    const renew = await t.db.select().from(tasks).where(eq(tasks.title, 'Renew: Health insurance'));
    expect(renew).toHaveLength(1);
    // every adult with folder access was told
    const bAlerts = (await t.db.select().from(notifications).where(and(eq(notifications.kind, 'vault_expiry'), eq(notifications.userId, B.user.id)))).filter((n: any) => n.data.docId === doc.body.id);
    expect(bAlerts).toHaveLength(3);
  });

  it('changing the date re-schedules; the old alerts never fire; deleting stops them', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    const folder = await A.post(`/api/groups/${g.id}/vault/folders`, { name: 'IDs', access: 'all' });
    const doc = await A.post(`/api/groups/${g.id}/vault/folders/${folder.body.id}/docs`, { title: 'Passport', expiresOn: '2027-01-31' });
    await A.patch(`/api/groups/${g.id}/vault/docs/${doc.body.id}`, { expiresOn: '2027-06-30' });
    t.setNow('2027-01-30T08:00:00Z');
    await t.runJobs();
    expect(await expiryAlerts(doc.body.id)).toHaveLength(0);
    t.setNow('2027-05-01T07:00:00Z');
    await t.runJobs();
    expect((await expiryAlerts(doc.body.id)).map((x: any) => x.data.days)).toEqual([60]);
    await A.del(`/api/groups/${g.id}/vault/docs/${doc.body.id}`);
    t.setNow('2027-06-29T07:00:00Z');
    await t.runJobs();
    expect(await expiryAlerts(doc.body.id)).toHaveLength(1);
  });
});

describe('vault folder access (B9 v1.5)', () => {
  it('a member without folder access gets 404 everywhere, search included; vault data is encrypted at rest', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    const secret = await A.post(`/api/groups/${g.id}/vault/folders`, { name: 'Medical reports', access: 'custom', memberIds: [B.user.id] });
    const up = await A.post(`/api/groups/${g.id}/vault/uploads`, { mime: 'image/png', size: 8 });
    const plain = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await t.app.request(up.body.uploadUrl, { method: 'PUT', body: plain })).status).toBe(200);
    const doc = await A.post(`/api/groups/${g.id}/vault/folders/${secret.body.id}/docs`, { title: 'MRI report', fileId: up.body.fileId, notes: 'Dr. Hany, Kasr El Aini' });
    expect(doc.body.ocrText).toContain('77-123-ABC');
    // B (listed) can open it; C can't — and can't tell it exists
    expect((await B.get(`/api/groups/${g.id}/vault/folders/${secret.body.id}`)).status).toBe(200);
    for (const [m, p, body] of [
      ['GET', `/api/groups/${g.id}/vault/folders/${secret.body.id}`],
      ['PATCH', `/api/groups/${g.id}/vault/docs/${doc.body.id}`, { title: 'x' }],
      ['GET', `/api/groups/${g.id}/vault/docs/${doc.body.id}/file`],
      ['POST', `/api/groups/${g.id}/vault/folders/${secret.body.id}/docs`, { title: 'x' }],
      ['DELETE', `/api/groups/${g.id}/vault/docs/${doc.body.id}`],
    ] as [string, string, unknown?][]) {
      expect((await C.req(m, p, body)).status, `${m} ${p}`).toBe(404);
    }
    expect((await C.get(`/api/groups/${g.id}/vault/folders`)).body.map((f: any) => f.name)).not.toContain('Medical reports');
    expect((await C.get(`/api/groups/${g.id}/vault/search?q=MRI`)).body).toEqual([]);
    expect((await C.get(`/api/groups/${g.id}/vault/search?q=77-123`)).body).toEqual([]);
    expect((await B.get(`/api/groups/${g.id}/vault/search?q=77-123`)).body.map((d: any) => d.title)).toEqual(['MRI report']);
    // the generic file route never serves vault files
    expect((await B.get(`/api/groups/${g.id}/files/${up.body.fileId}`)).status).toBe(404);
    const file = await B.req('GET', `/api/groups/${g.id}/vault/docs/${doc.body.id}/file`);
    expect(file.status).toBe(200);
    // at rest: notes/OCR sealed, bytes encrypted
    const [row] = await t.db.select().from(vaultDocs).where(eq(vaultDocs.id, doc.body.id));
    expect(row.notes!.startsWith('v1:')).toBe(true);
    expect(row.ocrText!.startsWith('v1:')).toBe(true);
    const [f] = await t.db.select().from(files).where(eq(files.id, up.body.fileId));
    const stored = await t.deps.storage.get(f.key);
    expect(Buffer.from(stored!).equals(Buffer.from(plain))).toBe(false);
    // admins-only folders hide from members
    const admins = await A.post(`/api/groups/${g.id}/vault/folders`, { name: 'Bank', access: 'admins' });
    expect((await B.get(`/api/groups/${g.id}/vault/folders/${admins.body.id}`)).status).toBe(404);
    expect((await B.post(`/api/groups/${g.id}/vault/folders`, { name: 'x' })).status).toBe(403);
  });
});

describe('meds (B9 v1.5)', () => {
  it('reminders fire at the local dose time in the group timezone, then the next day', async () => {
    t.setNow('2026-11-02T03:00:00Z');
    const med = await A.post(`/api/groups/${g.id}/meds`, { patientName: 'Dad', name: 'Metformin', dose: '500 mg', times: ['08:00', '20:00'], startOn: '2026-11-02' });
    const medJobs = async () => (await t.db.select().from(jobs).where(eq(jobs.kind, 'med_reminder'))).filter((j: any) => j.payload.medId === med.body.id);
    expect((await medJobs()).map((j) => j.runAt.toISOString()).sort()).toEqual(['2026-11-02T06:00:00.000Z', '2026-11-02T18:00:00.000Z']);
    const reminders = async () => (await t.db.select().from(notifications).where(and(eq(notifications.kind, 'med_reminder'), eq(notifications.userId, B.user.id)))).filter((n: any) => n.data.medId === med.body.id);
    t.setNow('2026-11-02T05:59:00Z');
    await t.runJobs();
    expect(await reminders()).toHaveLength(0);
    t.setNow('2026-11-02T06:00:00Z');
    await t.runJobs();
    expect(await reminders()).toHaveLength(1);
    expect((await medJobs()).filter((j) => j.status === 'pending').map((j) => j.runAt.toISOString()).sort()).toEqual(['2026-11-02T18:00:00.000Z', '2026-11-03T06:00:00.000Z']);
    // "given by"
    const list = await B.get(`/api/groups/${g.id}/meds`);
    const dose = list.body.find((m: any) => m.id === med.body.id).doses[0];
    expect(dose.scheduledAt).toBe('2026-11-02T06:00:00.000Z');
    const given = await B.post(`/api/groups/${g.id}/meds/${med.body.id}/doses/${dose.id}/given`);
    expect(given.body.givenBy).toBe(B.user.id);
  });

  it('a group in Dubai gets its 08:00 dose at 04:00 UTC; summer time in Cairo moves the UTC hour', async () => {
    const dubai = await makeGroup(A, 'care', 'Grandma in Dubai', { timezone: 'Asia/Dubai' });
    t.setNow('2026-11-02T00:00:00Z');
    const med = await A.post(`/api/groups/${dubai.id}/meds`, { patientName: 'Grandma', name: 'Vitamin D', times: ['08:00'], startOn: '2026-11-02' });
    const j = (await t.db.select().from(jobs).where(eq(jobs.kind, 'med_reminder'))).filter((x: any) => x.payload.medId === med.body.id);
    expect(j.map((x) => x.runAt.toISOString())).toEqual(['2026-11-02T04:00:00.000Z']);
    t.setNow('2027-05-10T00:00:00Z');
    const summer = await A.post(`/api/groups/${g.id}/meds`, { patientName: 'Dad', name: 'Aspirin', times: ['08:00'], startOn: '2027-05-10' });
    const js = (await t.db.select().from(jobs).where(eq(jobs.kind, 'med_reminder'))).filter((x: any) => x.payload.medId === summer.body.id);
    expect(js.map((x) => x.runAt.toISOString())).toEqual(['2027-05-10T05:00:00.000Z']);
  });
});

describe('emergency card & safety', () => {
  it('cards are encrypted; only you (or a parent / admin) can write yours', async () => {
    await B.put(`/api/groups/${g.id}/emergency/${B.user.id}`, { bloodType: 'O+', allergies: 'Penicillin', contacts: [{ name: 'Amal', phone: '+20100000000' }] });
    expect((await C.put(`/api/groups/${g.id}/emergency/${B.user.id}`, { bloodType: 'AB-' })).status).toBe(403);
    const cards = await C.get(`/api/groups/${g.id}/emergency`);
    expect(cards.body.find((x: any) => x.userId === B.user.id).card).toMatchObject({ bloodType: 'O+', allergies: 'Penicillin' });
    const [raw] = await t.db.select().from(emergencyCards).where(eq(emergencyCards.userId, B.user.id));
    expect(raw.data.startsWith('v1:')).toBe(true);
    expect(raw.data).not.toContain('Penicillin');
  });

  it('"arrived safely" and SOS notify everyone else', async () => {
    const res = await C.post(`/api/groups/${g.id}/safety/arrived`, { note: 'Home' });
    expect(res.body.notified).toBe(2);
    const inbox = await A.get('/api/me/inbox');
    expect(inbox.body.some((n: any) => n.kind === 'arrived_safely' && n.title.includes('Carla'))).toBe(true);
    await C.post(`/api/groups/${g.id}/safety/sos`, {});
    expect((await B.get('/api/me/inbox')).body.some((n: any) => n.kind === 'sos')).toBe(true);
  });

  it('cross-group: vault, meds and cards of another group → 404', async () => {
    const X = await t.signIn('x@example.com');
    const mine = await makeGroup(X, 'care', 'X care');
    const folder = (await A.get(`/api/groups/${g.id}/vault/folders`)).body[0];
    const [dose] = await t.db.select().from(medDoses).where(eq(medDoses.groupId, g.id)).limit(1);
    const med = { id: dose.medId, doses: [dose] };
    expect((await X.get(`/api/groups/${mine.id}/vault/folders/${folder.id}`)).status).toBe(404);
    expect((await X.post(`/api/groups/${mine.id}/meds/${med.id}/doses/${med.doses[0].id}/given`)).status).toBe(404);
    expect((await X.put(`/api/groups/${mine.id}/emergency/${B.user.id}`, { bloodType: 'A+' })).status).toBe(404);
  });
});
