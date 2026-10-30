import { schemas } from '@circle/shared';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { announcementReads, files, groupMembers, messages } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';

export function registerChatRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId/messages';
  const mod = { module: 'chat', tags: ['chat'] };

  r.get(base, { ...mod, perm: 'chat', summary: 'Messages, newest first', query: z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }) }, async (c, { query }) => {
    const groupId = c.get('group').id;
    const conds = [eq(messages.groupId, groupId), isNull(messages.deletedAt)];
    if (query.before) conds.push(lt(messages.createdAt, new Date(query.before)));
    const rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.createdAt)).limit(query.limit);
    await db.update(groupMembers).set({ lastReadAt: deps.clock() }).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, c.get('user').id)));
    return rows;
  });

  r.post(base, { ...mod, perm: 'chat', summary: 'Send a message (text, image, reply, @mentions)', body: schemas.messageCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    if (!body.body.trim() && !body.imageFileId && !body.audioFileId) throw badRequest('empty_message');
    if (body.audioFileId) {
      const [f] = await db.select().from(files).where(and(eq(files.id, body.audioFileId), eq(files.groupId, group.id)));
      if (!f || !f.mime.startsWith('audio/')) throw badRequest('bad_file');
    }
    if (body.pinned && !actorCan(c, 'announce')) throw forbidden();
    if (body.imageFileId) {
      const [f] = await db.select().from(files).where(and(eq(files.id, body.imageFileId), eq(files.groupId, group.id)));
      if (!f) throw badRequest('bad_file');
    }
    if (body.replyToId) {
      const [m] = await db.select().from(messages).where(and(eq(messages.id, body.replyToId), eq(messages.groupId, group.id)));
      if (!m) throw badRequest('bad_reply');
    }
    const memberRows = await db.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const memberSet = new Set(memberRows.map((m) => m.u));
    const mentions = (body.mentions ?? []).filter((m) => memberSet.has(m));
    const now = deps.clock();
    const msg = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(messages)
        .values({
          id: newId(),
          groupId: group.id,
          userId: user.id,
          body: body.body,
          imageFileId: body.imageFileId ?? null,
          audioFileId: body.audioFileId ?? null,
          audioMs: body.audioMs ?? null,
          replyToId: body.replyToId ?? null,
          mentions: mentions.length ? mentions : null,
          pinned: !!body.pinned,
          pinnedAt: body.pinned ? now : null,
          pinnedBy: body.pinned ? user.id : null,
          createdAt: now,
        })
        .returning();
      const name = c.get('member').displayName;
      if (mentions.length) {
        await notify(tx, { userIds: mentions, exclude: user.id, groupId: group.id, kind: 'mention', title: `${name} mentioned you`, body: body.body.slice(0, 140), data: { messageId: m.id }, now });
      }
      if (m.pinned) {
        await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'announced', entity: 'message', entityId: m.id, summary: body.body.slice(0, 80) });
        await notify(tx, { userIds: [...memberSet], exclude: user.id, groupId: group.id, kind: 'announcement', title: `📣 ${group.name}`, body: body.body.slice(0, 140), data: { messageId: m.id }, now });
      }
      await tx.update(groupMembers).set({ lastReadAt: now }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, user.id)));
      return m;
    });
    emit(c, { type: 'message', groupId: group.id, message: msg });
    return msg;
  });

  for (const pin of [true, false]) {
    r.post(`${base}/:messageId/${pin ? 'pin' : 'unpin'}`, { ...mod, perm: 'announce', summary: pin ? 'Pin as an announcement' : 'Unpin' }, async (c) => {
      const group = c.get('group');
      const user = c.get('user');
      const now = deps.clock();
      const row = await db.transaction(async (tx) => {
        const [m] = await tx
          .update(messages)
          .set({ pinned: pin, pinnedAt: pin ? now : null, pinnedBy: pin ? user.id : null })
          .where(and(eq(messages.id, c.req.param('messageId')!), eq(messages.groupId, group.id), isNull(messages.deletedAt)))
          .returning();
        if (!m) throw notFound();
        if (pin) {
          await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'announced', entity: 'message', entityId: m.id, summary: m.body.slice(0, 80) });
          const ids = (await tx.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).map((x) => x.u);
          await notify(tx, { userIds: ids, exclude: user.id, groupId: group.id, kind: 'announcement', title: `📣 ${group.name}`, body: m.body.slice(0, 140), data: { messageId: m.id }, now });
        }
        return m;
      });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'messages' });
      return row;
    });
  }

  r.delete(`${base}/:messageId`, { ...mod, perm: 'chat', summary: 'Delete your message' }, async (c) => {
    const group = c.get('group');
    const [m] = await db.select().from(messages).where(and(eq(messages.id, c.req.param('messageId')!), eq(messages.groupId, group.id)));
    if (!m) throw notFound();
    if (m.userId !== c.get('user').id && !actorCan(c, 'announce')) throw forbidden();
    await db.update(messages).set({ deletedAt: deps.clock() }).where(eq(messages.id, m.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'messages' });
    return { ok: true };
  });

  r.get('/groups/:groupId/announcements', { perm: 'chat', tags: ['chat'], summary: 'Pinned announcements with my read state' }, async (c) => {
    const groupId = c.get('group').id;
    const rows = await db.select().from(messages).where(and(eq(messages.groupId, groupId), eq(messages.pinned, true), isNull(messages.deletedAt))).orderBy(desc(messages.pinnedAt)).limit(50);
    const reads = rows.length
      ? await db.select().from(announcementReads).where(and(eq(announcementReads.groupId, groupId), inArray(announcementReads.messageId, rows.map((m) => m.id))))
      : [];
    const me = c.get('user').id;
    return rows.map((m) => {
      const mine = reads.find((x) => x.messageId === m.id && x.userId === me);
      return { ...m, read: !!mine, acknowledged: !!mine?.acknowledgedAt, readCount: reads.filter((x) => x.messageId === m.id).length, ackCount: reads.filter((x) => x.messageId === m.id && x.acknowledgedAt).length };
    });
  });

  r.post('/groups/:groupId/announcements/:messageId/read', { perm: 'chat', tags: ['chat'], summary: 'Mark an announcement read (ack=true to acknowledge)', body: z.object({ ack: z.boolean().optional() }) }, async (c, { body }) => {
    const groupId = c.get('group').id;
    const [m] = await db.select().from(messages).where(and(eq(messages.id, c.req.param('messageId')!), eq(messages.groupId, groupId), eq(messages.pinned, true)));
    if (!m) throw notFound();
    const now = deps.clock();
    await db
      .insert(announcementReads)
      .values({ messageId: m.id, groupId, userId: c.get('user').id, readAt: now, acknowledgedAt: body.ack ? now : null })
      .onConflictDoUpdate({ target: [announcementReads.messageId, announcementReads.userId], set: body.ack ? { acknowledgedAt: now } : { readAt: now } });
    emit(c, { type: 'invalidate', groupId, entity: 'announcements', id: m.id });
    return { ok: true };
  });
}
