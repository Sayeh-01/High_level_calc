import { schemas } from '@circle/shared';
import { and, asc, count, desc, eq, isNull, max, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { listItems, lists } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity } from '../effects';
import { notFound } from '../errors';
import { emit, type Router } from '../http';
import { newId } from '../ids';

export async function getList(db: DbOrTx, groupId: string, listId: string) {
  const [row] = await db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.groupId, groupId), isNull(lists.archivedAt)));
  if (!row) throw notFound();
  return row;
}

export async function addListItems(tx: DbOrTx, a: { groupId: string; listId: string; userId: string; items: { title: string; qty?: string | null; category?: string | null }[] }) {
  const [{ m }] = await tx.select({ m: max(listItems.position) }).from(listItems).where(eq(listItems.listId, a.listId));
  let pos = (m ?? -1) + 1;
  const rows = a.items.map((it) => ({ id: newId(), listId: a.listId, groupId: a.groupId, title: it.title, qty: it.qty ?? null, category: it.category ?? null, position: pos++, createdBy: a.userId }));
  if (rows.length) await tx.insert(listItems).values(rows);
  return rows;
}

export function registerListRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId/lists';
  const mod = { module: 'lists', tags: ['lists'] };

  r.get(base, { ...mod, perm: 'items.read', summary: 'Lists with item counts' }, async (c) => {
    const groupId = c.get('group').id;
    return db
      .select({
        id: lists.id,
        title: lists.title,
        createdAt: lists.createdAt,
        total: count(listItems.id),
        open: sql<number>`count(${listItems.id}) filter (where not ${listItems.checked})`.mapWith(Number),
      })
      .from(lists)
      .leftJoin(listItems, eq(listItems.listId, lists.id))
      .where(and(eq(lists.groupId, groupId), isNull(lists.archivedAt)))
      .groupBy(lists.id)
      .orderBy(desc(lists.createdAt));
  });

  r.post(base, { ...mod, perm: 'lists.create', summary: 'Create a list', body: schemas.listCreate }, async (c, { body }) => {
    const group = c.get('group');
    const row = await db.transaction(async (tx) => {
      const [l] = await tx.insert(lists).values({ id: newId(), groupId: group.id, title: body.title, createdBy: c.get('user').id }).returning();
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'list', entityId: l.id, summary: l.title });
      return l;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'lists' });
    return row;
  });

  r.get(`${base}/:listId`, { ...mod, perm: 'items.read', summary: 'A list and its items' }, async (c) => {
    const groupId = c.get('group').id;
    const list = await getList(db, groupId, c.req.param('listId')!);
    const items = await db.select().from(listItems).where(and(eq(listItems.listId, list.id), eq(listItems.groupId, groupId))).orderBy(asc(listItems.checked), asc(listItems.position));
    return { list, items };
  });

  r.patch(`${base}/:listId`, { ...mod, perm: 'lists.create', summary: 'Rename a list', body: schemas.listCreate }, async (c, { body }) => {
    const groupId = c.get('group').id;
    const list = await getList(db, groupId, c.req.param('listId')!);
    const [row] = await db.update(lists).set({ title: body.title }).where(and(eq(lists.id, list.id), eq(lists.groupId, groupId))).returning();
    emit(c, { type: 'invalidate', groupId, entity: 'lists', id: list.id });
    return row;
  });

  r.delete(`${base}/:listId`, { ...mod, perm: 'items.create', summary: 'Archive a list' }, async (c) => {
    const groupId = c.get('group').id;
    const list = await getList(db, groupId, c.req.param('listId')!);
    await db.transaction(async (tx) => {
      await tx.update(lists).set({ archivedAt: deps.clock() }).where(and(eq(lists.id, list.id), eq(lists.groupId, groupId)));
      await logActivity(tx, { groupId, actorId: c.get('user').id, verb: 'deleted', entity: 'list', entityId: list.id, summary: list.title });
    });
    emit(c, { type: 'invalidate', groupId, entity: 'lists' });
    return { ok: true };
  });

  r.post(`${base}/:listId/items`, { ...mod, perm: 'lists.create', summary: 'Add an item', body: schemas.listItemCreate }, async (c, { body }) => {
    const groupId = c.get('group').id;
    const list = await getList(db, groupId, c.req.param('listId')!);
    const [row] = await db.transaction((tx) => addListItems(tx, { groupId, listId: list.id, userId: c.get('user').id, items: [body] }));
    emit(c, { type: 'invalidate', groupId, entity: 'lists', id: list.id });
    return row;
  });

  r.patch(`${base}/:listId/items/:itemId`, { ...mod, perm: 'lists.create', summary: 'Check, uncheck or edit an item', body: schemas.listItemUpdate }, async (c, { body }) => {
    const groupId = c.get('group').id;
    const list = await getList(db, groupId, c.req.param('listId')!);
    const user = c.get('user');
    const row = await db.transaction(async (tx) => {
      const { checked, ...rest } = body;
      const [it] = await tx
        .update(listItems)
        .set({
          ...rest,
          ...(checked !== undefined && { checked, checkedBy: checked ? user.id : null, checkedAt: checked ? deps.clock() : null }),
        })
        .where(and(eq(listItems.id, c.req.param('itemId')!), eq(listItems.listId, list.id), eq(listItems.groupId, groupId)))
        .returning();
      if (!it) throw notFound();
      if (checked !== undefined) await logActivity(tx, { groupId, actorId: user.id, verb: checked ? 'checked' : 'unchecked', entity: 'list_item', entityId: it.id, summary: it.title });
      return it;
    });
    emit(c, { type: 'invalidate', groupId, entity: 'lists', id: list.id });
    return row;
  });

  r.delete(`${base}/:listId/items/:itemId`, { ...mod, perm: 'lists.create', summary: 'Remove an item' }, async (c) => {
    const groupId = c.get('group').id;
    const list = await getList(db, groupId, c.req.param('listId')!);
    const deleted = await db.delete(listItems).where(and(eq(listItems.id, c.req.param('itemId')!), eq(listItems.listId, list.id), eq(listItems.groupId, groupId))).returning();
    if (deleted.length === 0) throw notFound();
    emit(c, { type: 'invalidate', groupId, entity: 'lists', id: list.id });
    return { ok: true };
  });
}
