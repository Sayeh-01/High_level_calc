import { fromZoned, schemas, toZoned, type Role } from '@circle/shared';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { emergencyCards, files, groupMembers, groups, medDoses, meds, tasks, users, vaultDocs, vaultFolders } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, logActivity, notify } from '../effects';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { registerJob } from '../jobs';
import { dataKey, open, openBytes, seal, sealBytes } from '../seal';
import { assertNotChild } from './children';
import { signUpload } from './misc';

export const EXPIRY_ALERT_DAYS = [60, 30, 7] as const;
type Folder = typeof vaultFolders.$inferSelect;
type Doc = typeof vaultDocs.$inferSelect;

/** Folder ACL (A11 "Vault: per folder"): owner/admin see everything; others per the folder's access setting. */
export function canSeeFolder(folder: Folder, userId: string, role: Role) {
  if (role === 'owner' || role === 'admin') return true;
  if (folder.access === 'all') return role === 'manager' || role === 'member';
  if (folder.access === 'custom') return folder.memberIds.includes(userId);
  return false;
}

async function folderMemberIds(db: DbOrTx, folder: Folder) {
  const members = await db.select({ userId: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, folder.groupId));
  return members.filter((m) => canSeeFolder(folder, m.userId, m.role as Role)).map((m) => m.userId);
}

function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** One job per threshold, keyed by doc + threshold + expiry date: each alert fires exactly once, even if re-scheduled. */
export async function scheduleExpiry(tx: DbOrTx, deps: Deps, doc: Doc, tz: string) {
  if (!doc.expiresOn) return;
  for (const days of EXPIRY_ALERT_DAYS) {
    const at = fromZoned({ ...addDays(doc.expiresOn, -days), hour: 9, minute: 0 }, tz);
    if (at <= deps.clock().getTime()) continue;
    await enqueueJob(tx, { kind: 'vault_expiry', payload: { docId: doc.id, days, expiresOn: doc.expiresOn }, runAt: new Date(at), dedupeKey: `vault_expiry:${doc.id}:${days}:${doc.expiresOn}` });
  }
}

registerJob('vault_expiry', async (deps, p) => {
  const [doc] = await deps.db.select().from(vaultDocs).where(eq(vaultDocs.id, p.docId));
  if (!doc || doc.expiresOn !== p.expiresOn) return; // deleted or the date changed (a new set of jobs exists)
  const [folder] = await deps.db.select().from(vaultFolders).where(eq(vaultFolders.id, doc.folderId));
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, doc.groupId));
  if (!folder || !group) return;
  await deps.db.transaction(async (tx) => {
    await notify(tx, { userIds: await folderMemberIds(tx, folder), groupId: doc.groupId, kind: 'vault_expiry', title: `🗄️ ${doc.title}`, body: `Expires in ${p.days} days (${doc.expiresOn})`, data: { docId: doc.id, days: p.days, href: `/g/${doc.groupId}/vault` }, now: deps.clock() });
    // A8: "Lease ends in 60 days" creates a "Renew lease" task
    if (p.days === 60 && group.modules.includes('tasks')) {
      const due = fromZoned({ ...addDays(doc.expiresOn!, -30), hour: 9, minute: 0 }, group.timezone);
      await tx.insert(tasks).values({ id: newId(), groupId: doc.groupId, title: `Renew: ${doc.title}`, assigneeId: doc.createdBy, dueAt: new Date(due), createdBy: doc.createdBy });
    }
  });
});

// ── meds: one reminder job per dose time, rescheduled day by day in the group's timezone ────────
function localDay(instant: number, tz: string) {
  const z = toZoned(instant, tz);
  return `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;
}

export function nextDoseAt(time: string, tz: string, after: number, startOn: string): number {
  const [h, m] = time.split(':').map(Number);
  let day = localDay(after, tz) < startOn ? startOn : localDay(after, tz);
  for (let i = 0; i < 3; i++) {
    const at = fromZoned({ ...addDays(day, 0), hour: h, minute: m }, tz);
    if (at > after) return at;
    const nd = addDays(day, 1);
    day = `${nd.year}-${String(nd.month).padStart(2, '0')}-${String(nd.day).padStart(2, '0')}`;
  }
  throw new Error('unreachable');
}

async function scheduleMed(tx: DbOrTx, med: typeof meds.$inferSelect, tz: string, after: number) {
  for (const time of med.times) {
    const at = nextDoseAt(time, tz, after, med.startOn);
    if (med.endOn && localDay(at, tz) > med.endOn) continue;
    await enqueueJob(tx, { kind: 'med_reminder', payload: { medId: med.id, time, at: new Date(at).toISOString() }, runAt: new Date(at), dedupeKey: `med:${med.id}:${new Date(at).toISOString()}` });
  }
}

registerJob('med_reminder', async (deps, p) => {
  const [med] = await deps.db.select().from(meds).where(eq(meds.id, p.medId));
  if (!med || !med.active || !med.times.includes(p.time)) return;
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, med.groupId));
  if (!group) return;
  await deps.db.transaction(async (tx) => {
    await tx.insert(medDoses).values({ id: newId(), medId: med.id, groupId: med.groupId, scheduledAt: new Date(p.at) }).onConflictDoNothing();
    const carers = (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, med.groupId))).filter((m) => m.role !== 'child').map((m) => m.u);
    await notify(tx, { userIds: carers, groupId: med.groupId, kind: 'med_reminder', title: `💊 ${med.name} ${med.dose}`.trim(), body: `${med.patientName} · ${p.time}`, data: { medId: med.id, href: `/g/${med.groupId}/meds` }, now: deps.clock() });
    // the next dose at this time of day
    const next = nextDoseAt(p.time, group.timezone, new Date(p.at).getTime(), med.startOn);
    if (!med.endOn || localDay(next, group.timezone) <= med.endOn) {
      await enqueueJob(tx, { kind: 'med_reminder', payload: { medId: med.id, time: p.time, at: new Date(next).toISOString() }, runAt: new Date(next), dedupeKey: `med:${med.id}:${new Date(next).toISOString()}` });
    }
  });
});

export function registerCareRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const key = dataKey(deps.env.authSecret);
  const base = '/groups/:groupId';
  const vt = { module: 'vault', tags: ['vault'], perm: 'vault' as const };

  async function folderFor(c: Ctx, folderId: string) {
    const [f] = await db.select().from(vaultFolders).where(and(eq(vaultFolders.id, folderId), eq(vaultFolders.groupId, c.get('group').id)));
    // no access looks exactly like "doesn't exist" (B9 v1.5)
    if (!f || !canSeeFolder(f, c.get('user').id, c.get('member').role as Role)) throw notFound();
    return f;
  }
  async function docFor(c: Ctx, docId: string) {
    const [d] = await db.select().from(vaultDocs).where(and(eq(vaultDocs.id, docId), eq(vaultDocs.groupId, c.get('group').id)));
    if (!d) throw notFound();
    await folderFor(c, d.folderId);
    return d;
  }
  const show = (d: Doc) => ({ ...d, notes: open(key, d.notes), ocrText: open(key, d.ocrText) });

  async function runOcr(groupId: string, doc: Doc) {
    if (!deps.ai || !doc.fileId) return null;
    const [f] = await db.select().from(files).where(and(eq(files.id, doc.fileId), eq(files.groupId, groupId)));
    if (!f || !f.uploadedAt || !f.mime.startsWith('image/')) return null;
    const stored = await deps.storage.get(f.key);
    if (!stored) return null;
    const bytes = f.encrypted ? openBytes(key, stored) : stored;
    const text = await deps.ai.readImage('ocr', { system: 'You transcribe documents for a private family/group vault. Return only the text you can read.', image: { mime: f.mime, base64: Buffer.from(bytes).toString('base64') } });
    await db.update(vaultDocs).set({ ocrText: seal(key, text) }).where(eq(vaultDocs.id, doc.id));
    return text;
  }

  r.get(`${base}/vault/folders`, { ...vt, summary: 'Folders I can open' }, async (c) => {
    const all = await db.select().from(vaultFolders).where(eq(vaultFolders.groupId, c.get('group').id));
    const mine = all.filter((f) => canSeeFolder(f, c.get('user').id, c.get('member').role as Role));
    const docs = mine.length ? await db.select({ folderId: vaultDocs.folderId, expiresOn: vaultDocs.expiresOn }).from(vaultDocs).where(inArray(vaultDocs.folderId, mine.map((f) => f.id))) : [];
    return mine.map((f) => ({ ...f, docs: docs.filter((d) => d.folderId === f.id).length, nextExpiry: docs.filter((d) => d.folderId === f.id && d.expiresOn).map((d) => d.expiresOn!).sort()[0] ?? null }));
  });

  r.post(`${base}/vault/folders`, { ...vt, perm: 'group.settings', summary: 'New folder with access rules', body: schemas.folderCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.insert(vaultFolders).values({ id: newId(), groupId: group.id, name: body.name, access: body.access, memberIds: body.memberIds, createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'vault' });
    return row;
  });

  r.patch(`${base}/vault/folders/:folderId`, { ...vt, perm: 'group.settings', summary: 'Change a folder’s access', body: schemas.folderCreate.partial() }, async (c, { body }) => {
    const f = await folderFor(c, c.req.param('folderId')!);
    const [row] = await db.update(vaultFolders).set(body).where(eq(vaultFolders.id, f.id)).returning();
    emit(c, { type: 'invalidate', groupId: f.groupId, entity: 'vault' });
    return row;
  });

  r.get(`${base}/vault/folders/:folderId`, { ...vt, summary: 'A folder and its documents' }, async (c) => {
    const f = await folderFor(c, c.req.param('folderId')!);
    const docs = await db.select().from(vaultDocs).where(eq(vaultDocs.folderId, f.id)).orderBy(desc(vaultDocs.createdAt));
    return { folder: f, docs: docs.map(show) };
  });

  /** Vault uploads are encrypted at rest and never served by the generic file route. */
  r.post(`${base}/vault/uploads`, { ...vt, summary: 'Start an encrypted vault upload', body: z.object({ mime: z.string().max(100), size: z.number().int().positive().max(15 * 1024 * 1024) }) }, async (c, { body }) => {
    if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(body.mime)) throw badRequest('unsupported_type');
    const group = c.get('group');
    const id = newId();
    await db.insert(files).values({ id, groupId: group.id, ownerId: c.get('user').id, key: `vault/${group.id}/${id}`, mime: body.mime, size: body.size, encrypted: true });
    return { fileId: id, uploadUrl: `/api/uploads/${signUpload(deps.env.authSecret, id, deps.clock().getTime() + 10 * 60_000)}`, method: 'PUT' };
  });

  r.post(`${base}/vault/folders/:folderId/docs`, { ...vt, summary: 'Add a document', body: schemas.vaultDocCreate }, async (c, { body }) => {
    const group = c.get('group');
    const f = await folderFor(c, c.req.param('folderId')!);
    if (body.fileId) {
      const [file] = await db.select().from(files).where(and(eq(files.id, body.fileId), eq(files.groupId, group.id), eq(files.encrypted, true)));
      if (!file) throw badRequest('bad_file');
    }
    const doc = await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(vaultDocs)
        .values({ id: newId(), groupId: group.id, folderId: f.id, title: body.title, fileId: body.fileId ?? null, expiresOn: body.expiresOn ?? null, notes: seal(key, body.notes), createdBy: c.get('user').id })
        .returning();
      await scheduleExpiry(tx, deps, d, group.timezone);
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'vault_doc', entityId: d.id, summary: f.name });
      return d;
    });
    await runOcr(group.id, doc).catch(() => null);
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'vault' });
    const [fresh] = await db.select().from(vaultDocs).where(eq(vaultDocs.id, doc.id));
    return show(fresh);
  });

  r.patch(`${base}/vault/docs/:docId`, { ...vt, summary: 'Edit a document (re-schedules expiry alerts)', body: schemas.vaultDocUpdate }, async (c, { body }) => {
    const group = c.get('group');
    const d = await docFor(c, c.req.param('docId')!);
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(vaultDocs)
        .set({
          ...(body.title !== undefined && { title: body.title }),
          ...(body.expiresOn !== undefined && { expiresOn: body.expiresOn }),
          ...(body.notes !== undefined && { notes: seal(key, body.notes) }),
        })
        .where(eq(vaultDocs.id, d.id))
        .returning();
      if (row.expiresOn !== d.expiresOn) await scheduleExpiry(tx, deps, row, group.timezone);
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'vault' });
    return show(updated);
  });

  r.delete(`${base}/vault/docs/:docId`, { ...vt, summary: 'Delete a document' }, async (c) => {
    const d = await docFor(c, c.req.param('docId')!);
    if (d.createdBy !== c.get('user').id && !actorCan(c, 'group.settings')) throw forbidden();
    await db.delete(vaultDocs).where(eq(vaultDocs.id, d.id));
    emit(c, { type: 'invalidate', groupId: d.groupId, entity: 'vault' });
    return { ok: true };
  });

  r.get(`${base}/vault/docs/:docId/file`, { ...vt, summary: 'Download (decrypted) — folder access required' }, async (c) => {
    const d = await docFor(c, c.req.param('docId')!);
    if (!d.fileId) throw notFound();
    const [f] = await db.select().from(files).where(and(eq(files.id, d.fileId), eq(files.groupId, d.groupId)));
    const stored = f?.uploadedAt ? await deps.storage.get(f.key) : null;
    if (!f || !stored) throw notFound();
    const bytes = f.encrypted ? openBytes(key, stored) : stored;
    return new Response(Buffer.from(bytes), { headers: { 'content-type': f.mime, 'cache-control': 'private, no-store' } });
  });

  r.post(`${base}/vault/docs/:docId/ocr`, { ...vt, summary: 'Read the text inside an image (AI)' }, async (c) => {
    assertNotChild(c);
    if (!deps.ai) throw new HttpError(503, 'ai_disabled');
    const d = await docFor(c, c.req.param('docId')!);
    return { text: (await runOcr(d.groupId, d)) ?? '' };
  });

  r.get(`${base}/vault/search`, { ...vt, summary: 'Search titles, notes and text inside scans (only folders I can open)', query: z.object({ q: z.string().trim().min(1).max(100) }) }, async (c, { query }) => {
    const all = await db.select().from(vaultFolders).where(eq(vaultFolders.groupId, c.get('group').id));
    const mine = all.filter((f) => canSeeFolder(f, c.get('user').id, c.get('member').role as Role)).map((f) => f.id);
    if (!mine.length) return [];
    const docs = await db.select().from(vaultDocs).where(inArray(vaultDocs.folderId, mine));
    const needle = query.q.toLocaleLowerCase();
    // notes and OCR text are encrypted at rest, so matching happens after decrypting this group's documents
    return docs.map(show).filter((d) => [d.title, d.notes, d.ocrText].some((v) => v?.toLocaleLowerCase().includes(needle)));
  });

  // ── emergency card + safety ─────────────────────────────────────────────────
  const sf = { module: 'safety', tags: ['safety'] };
  r.get(`${base}/emergency`, { ...sf, perm: 'items.read', summary: 'Emergency cards of the group' }, async (c) => {
    const rows = await db.select().from(emergencyCards).where(eq(emergencyCards.groupId, c.get('group').id));
    return rows.map((r) => ({ userId: r.userId, updatedAt: r.updatedAt, card: JSON.parse(open(key, r.data) ?? '{}') }));
  });

  r.put(`${base}/emergency/:userId`, { ...sf, perm: 'items.read', summary: 'Write my card (parents can write their child’s)', body: schemas.emergencyCard }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user');
    const target = c.req.param('userId')!;
    const [m] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, target)));
    if (!m) throw notFound();
    if (target !== me.id) {
      const [u] = await db.select({ managedBy: users.managedBy }).from(users).where(eq(users.id, target));
      if (u?.managedBy !== me.id && !actorCan(c, 'group.settings')) throw forbidden();
    }
    const data = seal(key, JSON.stringify(body))!;
    await db
      .insert(emergencyCards)
      .values({ groupId: group.id, userId: target, data, updatedBy: me.id, updatedAt: deps.clock() })
      .onConflictDoUpdate({ target: [emergencyCards.groupId, emergencyCards.userId], set: { data, updatedBy: me.id, updatedAt: deps.clock() } });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'emergency' });
    return { ok: true };
  });

  for (const kind of ['arrived', 'sos'] as const) {
    r.post(`${base}/safety/${kind}`, { ...sf, perm: 'chat', summary: kind === 'arrived' ? '"Arrived safely" — one tap tells the group (no tracking)' : 'SOS to the group', body: schemas.safetyPing }, async (c, { body }) => {
      const group = c.get('group');
      const name = c.get('member').displayName;
      const others = (await db.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).map((x) => x.u);
      await db.transaction(async (tx) => {
        await notify(tx, {
          userIds: others,
          exclude: c.get('user').id,
          groupId: group.id,
          kind: kind === 'arrived' ? 'arrived_safely' : 'sos',
          title: kind === 'arrived' ? `✅ ${name} arrived safely` : `🆘 ${name} needs help`,
          body: body.note ?? '',
          data: { href: `/g/${group.id}/safety` },
          now: deps.clock(),
        });
        await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: kind === 'arrived' ? 'arrived' : 'sos', entity: 'safety', summary: body.note ?? '' });
      });
      return { notified: others.length - 1 };
    });
  }

  // ── meds ────────────────────────────────────────────────────────────────────
  const md = { module: 'meds', tags: ['meds'] };
  r.get(`${base}/meds`, { ...md, perm: 'items.read', summary: 'Meds with recent doses' }, async (c) => {
    const group = c.get('group');
    const list = await db.select().from(meds).where(eq(meds.groupId, group.id)).orderBy(desc(meds.createdAt));
    const since = new Date(deps.clock().getTime() - 36 * 3600_000);
    const doses = list.length ? await db.select().from(medDoses).where(and(inArray(medDoses.medId, list.map((m) => m.id)), gte(medDoses.scheduledAt, since))).orderBy(desc(medDoses.scheduledAt)) : [];
    return list.map((m) => ({ ...m, notes: open(key, m.notes), doses: doses.filter((d) => d.medId === m.id) }));
  });

  r.post(`${base}/meds`, { ...md, perm: 'items.create', summary: 'Add a medication schedule', body: schemas.medCreate }, async (c, { body }) => {
    const group = c.get('group');
    const med = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(meds)
        .values({ id: newId(), groupId: group.id, patientName: body.patientName, name: body.name, dose: body.dose, times: [...new Set(body.times)].sort(), startOn: body.startOn, endOn: body.endOn ?? null, notes: seal(key, body.notes), createdBy: c.get('user').id })
        .returning();
      await scheduleMed(tx, row, group.timezone, deps.clock().getTime());
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'med', entityId: row.id, summary: `${row.name} for ${row.patientName}` });
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meds' });
    return { ...med, notes: open(key, med.notes) };
  });

  r.patch(`${base}/meds/:medId`, { ...md, perm: 'items.create', summary: 'Pause or resume a medication', body: z.object({ active: z.boolean() }) }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.update(meds).set({ active: body.active }).where(and(eq(meds.id, c.req.param('medId')!), eq(meds.groupId, group.id))).returning();
    if (!row) throw notFound();
    if (body.active) await scheduleMed(db, row, group.timezone, deps.clock().getTime());
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meds' });
    return { ok: true };
  });

  r.post(`${base}/meds/:medId/doses/:doseId/given`, { ...md, perm: 'items.read', summary: 'Mark a dose given (records who gave it)' }, async (c) => {
    const group = c.get('group');
    const [dose] = await db
      .update(medDoses)
      .set({ givenAt: deps.clock(), givenBy: c.get('user').id, skipped: false })
      .where(and(eq(medDoses.id, c.req.param('doseId')!), eq(medDoses.medId, c.req.param('medId')!), eq(medDoses.groupId, group.id)))
      .returning();
    if (!dose) throw notFound();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meds' });
    return dose;
  });
}
