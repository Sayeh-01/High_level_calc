import { computeStreak, localDayKey, NEW_CARD, review, schemas } from '@circle/shared';
import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { cardReviews, cards, countdowns, decks, focusSessions, pages } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity } from '../effects';
import { forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';

const MAX_SESSION_MS = 3 * 60 * 60_000;

export function registerStudyRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';

  // ── focus together (presence itself rides the WebSocket; sessions give minutes and streaks) ─────
  const focus = { module: 'focus', tags: ['focus'] };
  r.post(`${base}/focus/start`, { ...focus, perm: 'items.read', summary: 'Start a focus session' }, async (c) => {
    const group = c.get('group');
    const userId = c.get('user').id;
    const now = deps.clock();
    await db.update(focusSessions).set({ endedAt: now }).where(and(eq(focusSessions.groupId, group.id), eq(focusSessions.userId, userId), isNull(focusSessions.endedAt)));
    const [row] = await db.insert(focusSessions).values({ id: newId(), groupId: group.id, userId, startedAt: now }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'focus' });
    return row;
  });

  r.post(`${base}/focus/stop`, { ...focus, perm: 'items.read', summary: 'Stop my focus session' }, async (c) => {
    const group = c.get('group');
    await db.update(focusSessions).set({ endedAt: deps.clock() }).where(and(eq(focusSessions.groupId, group.id), eq(focusSessions.userId, c.get('user').id), isNull(focusSessions.endedAt)));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'focus' });
    return { ok: true };
  });

  r.get(`${base}/focus`, { ...focus, perm: 'items.read', summary: 'Who is studying now, minutes today, streaks' }, async (c) => {
    const group = c.get('group');
    const now = deps.clock().getTime();
    const since = new Date(now - 120 * 86_400_000);
    const rows = await db.select().from(focusSessions).where(and(eq(focusSessions.groupId, group.id), gte(focusSessions.startedAt, since)));
    const today = localDayKey(now, group.timezone);
    const end = (s: (typeof rows)[number]) => Math.min(s.endedAt?.getTime() ?? now, s.startedAt.getTime() + MAX_SESSION_MS);
    const minutesToday: Record<string, number> = {};
    for (const s of rows) if (localDayKey(s.startedAt.getTime(), group.timezone) === today) minutesToday[s.userId] = (minutesToday[s.userId] ?? 0) + Math.round((end(s) - s.startedAt.getTime()) / 60_000);
    const active = rows.filter((s) => !s.endedAt && now - s.startedAt.getTime() < MAX_SESSION_MS).map((s) => ({ userId: s.userId, since: s.startedAt }));
    const me = c.get('user').id;
    return {
      active,
      minutesToday,
      groupStreak: computeStreak(rows.map((s) => s.startedAt.getTime()), group.timezone, now),
      myStreak: computeStreak(rows.filter((s) => s.userId === me).map((s) => s.startedAt.getTime()), group.timezone, now),
    };
  });

  r.get(`${base}/countdowns`, { ...focus, perm: 'items.read', summary: 'Exam countdowns' }, async (c) => {
    return db.select().from(countdowns).where(and(eq(countdowns.groupId, c.get('group').id), gte(countdowns.at, new Date(deps.clock().getTime() - 86_400_000)))).orderBy(asc(countdowns.at));
  });
  r.post(`${base}/countdowns`, { ...focus, perm: 'items.create', summary: 'Add a countdown', body: schemas.countdownCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.insert(countdowns).values({ id: newId(), groupId: group.id, title: body.title, at: new Date(body.at), createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'countdowns' });
    return row;
  });
  r.delete(`${base}/countdowns/:countdownId`, { ...focus, perm: 'items.create', summary: 'Remove a countdown' }, async (c) => {
    const res = await db.delete(countdowns).where(and(eq(countdowns.id, c.req.param('countdownId')!), eq(countdowns.groupId, c.get('group').id))).returning();
    if (!res.length) throw notFound();
    return { ok: true };
  });

  // ── flashcards with per-member spaced repetition ────────────────────────────
  const fc = { module: 'flashcards', tags: ['flashcards'] };
  r.get(`${base}/decks`, { ...fc, perm: 'items.read', summary: 'Decks with card counts and my due count' }, async (c) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const ds = await db.select().from(decks).where(eq(decks.groupId, group.id)).orderBy(desc(decks.createdAt));
    if (!ds.length) return [];
    const all = await db.select({ id: cards.id, deckId: cards.deckId }).from(cards).where(inArray(cards.deckId, ds.map((d) => d.id)));
    const reviews = all.length ? await db.select().from(cardReviews).where(and(eq(cardReviews.userId, me), inArray(cardReviews.cardId, all.map((x) => x.id)))) : [];
    const now = deps.clock().getTime();
    return ds.map((d) => {
      const mine = all.filter((x) => x.deckId === d.id);
      const due = mine.filter((x) => {
        const rv = reviews.find((r) => r.cardId === x.id);
        return !rv || rv.dueAt.getTime() <= now;
      }).length;
      return { ...d, cards: mine.length, due };
    });
  });

  r.post(`${base}/decks`, { ...fc, perm: 'items.create', summary: 'New deck', body: schemas.deckCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.insert(decks).values({ id: newId(), groupId: group.id, title: body.title, createdBy: c.get('user').id }).returning();
    await logActivity(db, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'deck', entityId: row.id, summary: row.title });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'decks' });
    return row;
  });

  async function deck(groupId: string, deckId: string) {
    const [d] = await db.select().from(decks).where(and(eq(decks.id, deckId), eq(decks.groupId, groupId)));
    if (!d) throw notFound();
    return d;
  }

  r.get(`${base}/decks/:deckId`, { ...fc, perm: 'items.read', summary: 'A deck and its cards' }, async (c) => {
    const d = await deck(c.get('group').id, c.req.param('deckId')!);
    return { deck: d, cards: await db.select().from(cards).where(eq(cards.deckId, d.id)).orderBy(asc(cards.createdAt)) };
  });

  r.post(`${base}/decks/:deckId/cards`, { ...fc, perm: 'items.create', summary: 'Add a card', body: schemas.cardCreate }, async (c, { body }) => {
    const group = c.get('group');
    const d = await deck(group.id, c.req.param('deckId')!);
    const [row] = await db.insert(cards).values({ id: newId(), deckId: d.id, groupId: group.id, front: body.front, back: body.back, createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'decks' });
    return row;
  });

  r.delete(`${base}/cards/:cardId`, { ...fc, perm: 'items.create', summary: 'Delete a card' }, async (c) => {
    const group = c.get('group');
    const [card] = await db.select().from(cards).where(and(eq(cards.id, c.req.param('cardId')!), eq(cards.groupId, group.id)));
    if (!card) throw notFound();
    if (card.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    await db.delete(cards).where(eq(cards.id, card.id));
    return { ok: true };
  });

  r.get(`${base}/decks/:deckId/study`, { ...fc, perm: 'items.read', summary: 'My cards due now (new cards first)' }, async (c) => {
    const d = await deck(c.get('group').id, c.req.param('deckId')!);
    const me = c.get('user').id;
    const all = await db.select().from(cards).where(eq(cards.deckId, d.id));
    const reviews = all.length ? await db.select().from(cardReviews).where(and(eq(cardReviews.userId, me), inArray(cardReviews.cardId, all.map((x) => x.id)))) : [];
    const now = deps.clock().getTime();
    const due = all
      .map((card) => ({ card, rv: reviews.find((r) => r.cardId === card.id) }))
      .filter((x) => !x.rv || x.rv.dueAt.getTime() <= now)
      .sort((a, b) => (a.rv ? a.rv.dueAt.getTime() : 0) - (b.rv ? b.rv.dueAt.getTime() : 0));
    return due.slice(0, 50).map((x) => ({ ...x.card, reps: x.rv?.reps ?? 0 }));
  });

  r.post(`${base}/cards/:cardId/review`, { ...fc, perm: 'items.read', summary: 'Grade my recall (SM-2)', body: schemas.cardReview }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const [card] = await db.select().from(cards).where(and(eq(cards.id, c.req.param('cardId')!), eq(cards.groupId, group.id)));
    if (!card) throw notFound();
    const [prev] = await db.select().from(cardReviews).where(and(eq(cardReviews.cardId, card.id), eq(cardReviews.userId, me)));
    const next = review(prev ? { ease: prev.ease, interval: prev.interval, reps: prev.reps } : NEW_CARD, body.grade);
    const now = deps.clock();
    const dueAt = new Date(now.getTime() + next.interval * 86_400_000);
    await db
      .insert(cardReviews)
      .values({ cardId: card.id, userId: me, groupId: group.id, ...next, dueAt, reviewedAt: now })
      .onConflictDoUpdate({ target: [cardReviews.cardId, cardReviews.userId], set: { ...next, dueAt, reviewedAt: now } });
    return { ...next, dueAt };
  });

  // ── notes & wiki ────────────────────────────────────────────────────────────
  const nt = { module: 'notes', tags: ['notes'] };
  r.get(`${base}/pages`, { ...nt, perm: 'items.read', summary: 'Wiki pages' }, async (c) => {
    return db.select({ id: pages.id, title: pages.title, updatedAt: pages.updatedAt, updatedBy: pages.updatedBy }).from(pages).where(eq(pages.groupId, c.get('group').id)).orderBy(desc(pages.updatedAt));
  });
  r.post(`${base}/pages`, { ...nt, perm: 'items.create', summary: 'New page', body: schemas.pageUpsert }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const [row] = await db.insert(pages).values({ id: newId(), groupId: group.id, title: body.title, body: body.body, createdBy: me, updatedBy: me, updatedAt: deps.clock() }).returning();
    await logActivity(db, { groupId: group.id, actorId: me, verb: 'created', entity: 'page', entityId: row.id, summary: row.title });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'pages' });
    return row;
  });
  r.get(`${base}/pages/:pageId`, { ...nt, perm: 'items.read', summary: 'A page' }, async (c) => {
    const [p] = await db.select().from(pages).where(and(eq(pages.id, c.req.param('pageId')!), eq(pages.groupId, c.get('group').id)));
    if (!p) throw notFound();
    return p;
  });
  r.patch(`${base}/pages/:pageId`, { ...nt, perm: 'items.create', summary: 'Edit a page', body: schemas.pageUpsert }, async (c, { body }) => {
    const group = c.get('group');
    const [p] = await db.update(pages).set({ title: body.title, body: body.body, updatedBy: c.get('user').id, updatedAt: deps.clock() }).where(and(eq(pages.id, c.req.param('pageId')!), eq(pages.groupId, group.id))).returning();
    if (!p) throw notFound();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'pages' });
    return p;
  });
  r.delete(`${base}/pages/:pageId`, { ...nt, perm: 'items.create', summary: 'Delete a page' }, async (c) => {
    const group = c.get('group');
    const [p] = await db.select().from(pages).where(and(eq(pages.id, c.req.param('pageId')!), eq(pages.groupId, group.id)));
    if (!p) throw notFound();
    if (p.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    await db.delete(pages).where(eq(pages.id, p.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'pages' });
    return { ok: true };
  });
}

