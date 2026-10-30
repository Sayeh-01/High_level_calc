import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { activity, files } from '../db/schema';
import type { Deps } from '../deps';
import { HttpError, badRequest, notFound } from '../errors';
import type { Router } from '../http';
import { newId } from '../ids';
import { dataKey, sealBytes } from '../seal';

const MAX_UPLOAD = 15 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic)|audio\/(m4a|mp4|mpeg|aac|webm|ogg|x-m4a)|application\/pdf|text\/plain)$/;

export function signUpload(secret: string, fileId: string, expires: number) {
  const sig = createHmac('sha256', secret).update(`${fileId}.${expires}`).digest('base64url');
  return `${fileId}.${expires}.${sig}`;
}

export function verifyUpload(secret: string, token: string, now: number): string | null {
  const [fileId, exp, sig] = token.split('.');
  if (!fileId || !exp || !sig) return null;
  const expected = createHmac('sha256', secret).update(`${fileId}.${exp}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(exp) < now) return null;
  return fileId;
}

export function registerMiscRoutes(r: Router, deps: Deps) {
  const { db } = deps;

  r.get('/groups/:groupId/activity', { perm: 'items.read', tags: ['activity'], summary: 'Per-group activity feed', query: z.object({ before: z.string().optional() }) }, async (c, { query }) => {
    const groupId = c.get('group').id;
    const conds = [eq(activity.groupId, groupId)];
    if (query.before) conds.push(lt(activity.createdAt, new Date(query.before)));
    return db.select().from(activity).where(and(...conds)).orderBy(desc(activity.createdAt)).limit(100);
  });

  /** Presigned upload: the app gets a short-lived URL and PUTs the bytes there (local driver now, R2 later). */
  r.post('/groups/:groupId/files', { perm: 'chat', tags: ['files'], summary: 'Start an upload', body: z.object({ mime: z.string().max(100), size: z.number().int().positive().max(MAX_UPLOAD) }) }, async (c, { body }) => {
    if (!ALLOWED.test(body.mime)) throw badRequest('unsupported_type');
    const group = c.get('group');
    const id = newId();
    await db.insert(files).values({ id, groupId: group.id, ownerId: c.get('user').id, key: `groups/${group.id}/${id}`, mime: body.mime, size: body.size });
    const token = signUpload(deps.env.authSecret, id, deps.clock().getTime() + 10 * 60_000);
    return { fileId: id, uploadUrl: `/api/uploads/${token}`, method: 'PUT' };
  });

  /** Profile photos are not in any group. */
  r.post('/me/photo', { tags: ['me'], summary: 'Start a profile photo upload', body: z.object({ mime: z.string().max(100), size: z.number().int().positive().max(MAX_UPLOAD) }) }, async (c, { body }) => {
    if (!body.mime.startsWith('image/') || !ALLOWED.test(body.mime)) throw badRequest('unsupported_type');
    const id = newId();
    await db.insert(files).values({ id, groupId: null, ownerId: c.get('user').id, key: `users/${c.get('user').id}/${id}`, mime: body.mime, size: body.size });
    const token = signUpload(deps.env.authSecret, id, deps.clock().getTime() + 10 * 60_000);
    return { fileId: id, uploadUrl: `/api/uploads/${token}`, method: 'PUT', imageUrl: `/api/photos/${id}` };
  });

  r.get('/photos/:fileId', { tags: ['me'], summary: 'A profile photo' }, async (c) => {
    const [f] = await db.select().from(files).where(and(eq(files.id, c.req.param('fileId')!), isNull(files.groupId)));
    if (!f || !f.uploadedAt) throw notFound();
    const data = await deps.storage.get(f.key);
    if (!data) throw notFound();
    return new Response(Buffer.from(data), { headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=86400' } });
  });

  r.put('/uploads/:token', { auth: 'public', tags: ['files'], summary: 'Upload target for a presigned URL' }, async (c) => {
    const fileId = verifyUpload(deps.env.authSecret, c.req.param('token')!, deps.clock().getTime());
    if (!fileId) throw new HttpError(403, 'bad_upload_token');
    const [f] = await db.select().from(files).where(eq(files.id, fileId));
    if (!f || f.uploadedAt) throw notFound();
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > MAX_UPLOAD) throw badRequest('too_large');
    await deps.storage.put(f.key, f.encrypted ? sealBytes(dataKey(deps.env.authSecret), data) : data, f.mime);
    await db.update(files).set({ uploadedAt: deps.clock(), size: data.byteLength }).where(eq(files.id, f.id));
    return { ok: true, fileId: f.id };
  });

  r.get('/groups/:groupId/files/:fileId', { perm: 'items.read', tags: ['files'], summary: 'Download a file' }, async (c) => {
    const [f] = await db.select().from(files).where(and(eq(files.id, c.req.param('fileId')!), eq(files.groupId, c.get('group').id)));
    // vault files are only served through the vault route, which checks folder access
    if (!f || !f.uploadedAt || f.encrypted) throw notFound();
    const data = await deps.storage.get(f.key);
    if (!data) throw notFound();
    return new Response(Buffer.from(data), { headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=86400' } });
  });
}
