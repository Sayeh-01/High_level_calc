import { can, schemas, type Role } from '@circle/shared';
import { and, asc, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { AiRefusal } from '../ai';
import { groupMembers, groups, lists, messages, pages } from '../db/schema';
import type { Deps } from '../deps';
import { HttpError, badRequest, notFound } from '../errors';
import type { Ctx, Router } from '../http';
import { assertNotChild } from './children';

const captureSchema = z.object({
  kind: z.enum(['task', 'event', 'list_item']),
  title: z.string().min(1).max(200),
  groupId: z.string().nullable(),
  assigneeIds: z.array(z.string()).max(20),
  when: z.string().nullable(),
  listId: z.string().nullable(),
});
const chatItemsSchema = z.object({
  items: z.array(z.object({ kind: z.enum(['task', 'event']), title: z.string().min(1).max(200), when: z.string().nullable(), sourceMessageId: z.string() })).max(10),
});
const quizSchema = z.object({ cards: z.array(z.object({ front: z.string().min(1).max(500), back: z.string().min(1).max(1000) })).max(30) });

const validDate = (s: string | null | undefined) => (s && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);

export function registerAiRoutes(r: Router, deps: Deps) {
  const { db } = deps;

  function model(c: Ctx) {
    assertNotChild(c); // no AI for Child accounts (A10)
    if (!deps.ai) throw new HttpError(503, 'ai_disabled');
    return deps.ai;
  }
  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiRefusal) throw new HttpError(422, 'ai_declined');
      if (e instanceof z.ZodError) throw new HttpError(422, 'ai_bad_output');
      throw e;
    }
  }

  /**
   * Smart quick capture. The model only sees the groups this user belongs to (and may create items in), and its answer is
   * checked again: a group, assignee or list the user can't use is dropped. Returns a draft; nothing is saved.
   */
  r.post('/ai/capture', { tags: ['ai'], summary: 'Sentence → draft task/event/list item (not saved)', body: schemas.aiCapture }, async (c, { body }) => {
    const ai = model(c);
    const user = c.get('user');
    const mine = await db
      .select({ id: groups.id, name: groups.name, type: groups.type, modules: groups.modules, settings: groups.settings, role: groupMembers.role, customRoleId: groupMembers.customRoleId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, user.id));
    const usable = mine.filter((g) => can(g.role as Role, 'items.create', g.settings as any, g.customRoleId));
    const ids = usable.map((g) => g.id);
    const members = ids.length ? await db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId, name: groupMembers.displayName }).from(groupMembers).where(inArray(groupMembers.groupId, ids)) : [];
    const groupLists = ids.length ? await db.select({ id: lists.id, groupId: lists.groupId, title: lists.title }).from(lists).where(and(inArray(lists.groupId, ids), isNull(lists.archivedAt))) : [];
    const context = {
      text: body.text,
      now: deps.clock().toISOString(),
      timezone: user.timezone ?? 'Africa/Cairo',
      groups: usable.map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        modules: g.modules,
        members: members.filter((m) => m.groupId === g.id).map((m) => ({ userId: m.userId, name: m.name })),
        lists: groupLists.filter((l) => l.groupId === g.id).map((l) => ({ id: l.id, title: l.title })),
      })),
    };
    const raw = await guard(() =>
      ai.json('capture', {
        system:
          'You turn one sentence from a user into a draft item for their group organizer. Choose a group only from the context; use null if unsure. Assignees must be members of that group. "when" is an ISO 8601 instant in the user timezone or null. Keep the title short, without the date words.',
        prompt: `<context>${JSON.stringify(context)}</context>`,
        schema: captureSchema,
      }),
    );
    const group = usable.find((g) => g.id === raw.groupId) ?? null;
    const groupMemberIds = new Set(members.filter((m) => m.groupId === group?.id).map((m) => m.userId));
    const draft = {
      kind: raw.kind,
      title: raw.title,
      groupId: group?.id ?? null,
      assigneeIds: group ? raw.assigneeIds.filter((u) => groupMemberIds.has(u)) : [],
      when: validDate(raw.when),
      listId: group && groupLists.some((l) => l.id === raw.listId && l.groupId === group.id) ? raw.listId : null,
    };
    return { draft, saved: false };
  });

  r.post('/groups/:groupId/ai/chat-items', { module: 'chat', perm: 'items.create', tags: ['ai'], summary: 'Suggest tasks/events from recent chat (drafts)' }, async (c) => {
    const ai = model(c);
    const group = c.get('group');
    const recent = (await db.select().from(messages).where(and(eq(messages.groupId, group.id), isNull(messages.deletedAt), ne(messages.body, ''))).orderBy(desc(messages.createdAt)).limit(40)).reverse();
    if (!recent.length) return { items: [] };
    const names = await db.select({ userId: groupMembers.userId, name: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const context = {
      now: deps.clock().toISOString(),
      timezone: group.timezone,
      messages: recent.map((m) => ({ id: m.id, author: names.find((n) => n.userId === m.userId)?.name ?? '?', body: m.body, at: m.createdAt.toISOString() })),
    };
    const raw = await guard(() =>
      ai.json('chat_items', {
        system: 'Find concrete plans or to-dos in this group chat and propose them as events (with a time) or tasks. Only propose what people actually said. Cite the message id each one comes from.',
        prompt: `<context>${JSON.stringify(context)}</context>`,
        schema: chatItemsSchema,
      }),
    );
    const known = new Set(recent.map((m) => m.id));
    return { items: raw.items.filter((i) => known.has(i.sourceMessageId)).map((i) => ({ ...i, when: validDate(i.when) })), saved: false };
  });

  r.post('/groups/:groupId/ai/catchup', { module: 'chat', perm: 'chat', tags: ['ai'], summary: '"What did I miss?" — summary of my unread messages' }, async (c) => {
    const ai = model(c);
    const group = c.get('group');
    const member = c.get('member');
    const unread = await db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, group.id), isNull(messages.deletedAt), gt(messages.createdAt, member.lastReadAt), ne(messages.userId, member.userId)))
      .orderBy(asc(messages.createdAt))
      .limit(300);
    if (!unread.length) return { unread: 0, summary: '' };
    const names = await db.select({ userId: groupMembers.userId, name: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const context = { messages: unread.map((m) => ({ author: names.find((n) => n.userId === m.userId)?.name ?? '?', body: m.body, pinned: m.pinned })) };
    const summary = await guard(() =>
      ai.text('catchup', {
        system: `Summarize these unread group-chat messages in at most 5 short bullet points, in the language the messages are written in. Mention decisions, plans, money and anything addressed to ${member.displayName}.`,
        prompt: `<context>${JSON.stringify(context)}</context>`,
        maxTokens: 2000,
      }),
    );
    return { unread: unread.length, summary };
  });

  r.post('/groups/:groupId/ai/quiz', { module: 'flashcards', perm: 'items.create', tags: ['ai'], summary: 'Notes → draft flashcards (not saved)', body: schemas.aiQuiz }, async (c, { body }) => {
    const ai = model(c);
    const group = c.get('group');
    let text = body.text ?? '';
    if (body.pageId) {
      const [p] = await db.select().from(pages).where(and(eq(pages.id, body.pageId), eq(pages.groupId, group.id)));
      if (!p) throw notFound();
      text = `${p.title}\n\n${p.body}`;
    }
    if (!text.trim()) throw badRequest('no_text');
    const raw = await guard(() =>
      ai.json('quiz', {
        system: `Write up to ${body.count} flashcards (question on the front, short answer on the back) that test the key facts in these notes. Use the notes' language. Don't invent facts that aren't in the notes.`,
        prompt: `<context>${JSON.stringify({ text: text.slice(0, 20000), count: body.count })}</context>`,
        schema: quizSchema,
      }),
    );
    return { cards: raw.cards.slice(0, body.count), saved: false };
  });

}
