import { formatQty, localDayKey, mergeIngredients, normalizeName, normalizeUnit, parseQty, schemas } from '@circle/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { files, groupMembers, listItems, lists, meals, memories } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity } from '../effects';
import { badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId } from '../ids';
import { esc } from './guest';
import { addListItems } from './lists';

const MAX_BOOK_IMAGE_BYTES = 8 * 1024 * 1024;

export function registerLifeRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';

  // ── meal planner → groceries ────────────────────────────────────────────────
  const ml = { module: 'meals', tags: ['meals'] };
  r.get(`${base}/meals`, { ...ml, perm: 'items.read', summary: 'Meals in a day range', query: z.object({ from: z.string().optional(), to: z.string().optional() }) }, async (c, { query }) => {
    const group = c.get('group');
    const today = localDayKey(deps.clock().getTime(), group.timezone);
    const from = query.from ?? today;
    const to = query.to ?? localDayKey(deps.clock().getTime() + 13 * 86_400_000, group.timezone);
    return db.select().from(meals).where(and(eq(meals.groupId, group.id), gte(meals.day, from), lte(meals.day, to))).orderBy(asc(meals.day), asc(meals.slot));
  });

  r.post(`${base}/meals`, { ...ml, perm: 'items.create', summary: 'Plan a meal', body: schemas.mealCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.insert(meals).values({ id: newId(), groupId: group.id, day: body.day, slot: body.slot, title: body.title, ingredients: body.ingredients, createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meals' });
    return row;
  });

  r.delete(`${base}/meals/:mealId`, { ...ml, perm: 'items.create', summary: 'Remove a meal' }, async (c) => {
    const group = c.get('group');
    const [m] = await db.select().from(meals).where(and(eq(meals.id, c.req.param('mealId')!), eq(meals.groupId, group.id)));
    if (!m) throw notFound();
    if (m.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    await db.delete(meals).where(eq(meals.id, m.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'meals' });
    return { ok: true };
  });

  /** Plan the week, and the ingredients drop into the grocery list (A6), merged by ingredient + unit (B9 v1.4). */
  r.post(`${base}/meals/to-list`, { ...ml, perm: 'lists.create', summary: 'Put the planned ingredients on a grocery list', body: schemas.mealsToList }, async (c, { body }) => {
    const group = c.get('group');
    if (!group.modules.includes('lists')) throw badRequest('lists_module_off');
    const user = c.get('user');
    const planned = await db.select().from(meals).where(and(eq(meals.groupId, group.id), gte(meals.day, body.from), lte(meals.day, body.to)));
    const merged = mergeIngredients(planned.flatMap((m) => m.ingredients));
    const result = await db.transaction(async (tx) => {
      let listId = body.listId;
      if (listId) {
        const [l] = await tx.select().from(lists).where(and(eq(lists.id, listId), eq(lists.groupId, group.id), isNull(lists.archivedAt)));
        if (!l) throw badRequest('bad_list');
      } else {
        const [existing] = await tx.select().from(lists).where(and(eq(lists.groupId, group.id), isNull(lists.archivedAt))).orderBy(asc(lists.createdAt)).limit(1);
        listId = existing?.id ?? (await tx.insert(lists).values({ id: newId(), groupId: group.id, title: 'Groceries', createdBy: user.id }).returning())[0].id;
      }
      // merge into unchecked lines that are already on the list
      const open = await tx.select().from(listItems).where(and(eq(listItems.listId, listId), eq(listItems.checked, false)));
      let updated = 0;
      const toAdd: { title: string; qty: string | null }[] = [];
      for (const ing of merged) {
        const match = open.find((it) => normalizeName(it.title) === normalizeName(ing.name) && parseQty(it.qty).unit === normalizeUnit(ing.unit));
        if (match) {
          const prev = parseQty(match.qty).qty;
          const qty = prev === null && ing.qty === null ? null : (prev ?? 0) + (ing.qty ?? 0);
          await tx.update(listItems).set({ qty: formatQty(qty, ing.unit) }).where(eq(listItems.id, match.id));
          updated++;
        } else toAdd.push({ title: ing.name, qty: formatQty(ing.qty, ing.unit) });
      }
      await addListItems(tx, { groupId: group.id, listId, userId: user.id, items: toAdd });
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'updated', entity: 'list', entityId: listId, summary: `${merged.length} ingredients from the meal plan` });
      return { listId, added: toAdd.length, updated, ingredients: merged.length };
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'lists' });
    return result;
  });

  // ── memories + yearly book ──────────────────────────────────────────────────
  const mm = { module: 'memories', tags: ['memories'] };
  r.get(`${base}/memories`, { ...mm, perm: 'items.read', summary: 'Memories timeline', query: z.object({ year: z.string().regex(/^\d{4}$/).optional() }) }, async (c, { query }) => {
    const group = c.get('group');
    const conds = [eq(memories.groupId, group.id)];
    if (query.year) conds.push(gte(memories.day, `${query.year}-01-01`), lte(memories.day, `${query.year}-12-31`));
    return db.select().from(memories).where(and(...conds)).orderBy(desc(memories.day), desc(memories.createdAt)).limit(500);
  });

  r.post(`${base}/memories`, { ...mm, perm: 'items.create', summary: 'Add a memory (text + photos)', body: schemas.memoryCreate }, async (c, { body }) => {
    const group = c.get('group');
    if (!body.text.trim() && body.photoFileIds.length === 0) throw badRequest('empty_memory');
    if (body.photoFileIds.length) {
      const owned = await db.select({ id: files.id }).from(files).where(and(eq(files.groupId, group.id), inArray(files.id, body.photoFileIds)));
      if (owned.length !== new Set(body.photoFileIds).size) throw badRequest('bad_file');
    }
    const [row] = await db.insert(memories).values({ id: newId(), groupId: group.id, userId: c.get('user').id, day: body.day, text: body.text, photoFileIds: body.photoFileIds }).returning();
    await logActivity(db, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'memory', entityId: row.id, summary: body.text.slice(0, 60) });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'memories' });
    return row;
  });

  r.delete(`${base}/memories/:memoryId`, { ...mm, perm: 'items.read', summary: 'Delete a memory' }, async (c) => {
    const group = c.get('group');
    const [m] = await db.select().from(memories).where(and(eq(memories.id, c.req.param('memoryId')!), eq(memories.groupId, group.id)));
    if (!m) throw notFound();
    if (m.userId !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    await db.delete(memories).where(eq(memories.id, m.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'memories' });
    return { ok: true };
  });

  /**
   * The yearly keepsake book as HTML. The phone turns it into a PDF with expo-print, because the device's browser engine
   * shapes Arabic correctly (B3, B7 #12). Photos are embedded so the PDF needs no network or session.
   */
  r.get(`${base}/memories/book`, { ...mm, perm: 'items.read', summary: 'Yearly book (HTML for expo-print)', query: z.object({ year: z.string().regex(/^\d{4}$/), lang: z.enum(['en', 'ar']).default('en') }) }, async (c, { query }) => {
    const group = c.get('group');
    const rows = await db
      .select()
      .from(memories)
      .where(and(eq(memories.groupId, group.id), gte(memories.day, `${query.year}-01-01`), lte(memories.day, `${query.year}-12-31`)))
      .orderBy(asc(memories.day), asc(memories.createdAt));
    const names = await db.select({ userId: groupMembers.userId, name: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const photoIds = rows.flatMap((m) => m.photoFileIds);
    const photoRows = photoIds.length ? await db.select().from(files).where(and(eq(files.groupId, group.id), inArray(files.id, photoIds))) : [];
    let budget = MAX_BOOK_IMAGE_BYTES;
    const dataUris = new Map<string, string>();
    for (const f of photoRows) {
      if (!f.mime.startsWith('image/') || !f.uploadedAt || f.size > budget) continue;
      const bytes = await deps.storage.get(f.key);
      if (!bytes) continue;
      budget -= bytes.byteLength;
      dataUris.set(f.id, `data:${f.mime};base64,${Buffer.from(bytes).toString('base64')}`);
    }
    const ar = query.lang === 'ar';
    const fmt = new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const entries = rows
      .map((m) => {
        const [y, mo, d] = m.day.split('-').map(Number);
        const imgs = m.photoFileIds.map((id) => dataUris.get(id)).filter(Boolean).map((src) => `<img src="${src}" alt="">`).join('');
        const who = names.find((n) => n.userId === m.userId)?.name ?? '';
        return `<section class="entry"><h2>${esc(fmt.format(new Date(Date.UTC(y, mo - 1, d))))}</h2>${imgs ? `<div class="photos">${imgs}</div>` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}<p class="who">${esc(who)}</p></section>`;
      })
      .join('\n');
    const title = `${group.emoji} ${group.name} · ${query.year}`;
    const html = `<!doctype html><html lang="${query.lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{margin:18mm}body{font-family:-apple-system,"Segoe UI","Noto Naskh Arabic","Noto Sans Arabic",sans-serif;color:#1C1C1E}
.cover{height:90vh;display:flex;flex-direction:column;justify-content:center;align-items:center;page-break-after:always}
.cover h1{font-size:40px;margin:0}.cover p{color:#66666D}.entry{page-break-inside:avoid;margin-bottom:28px}h2{font-size:18px;color:${esc(group.color)};margin:0 0 8px}
.photos{display:flex;flex-wrap:wrap;gap:8px}.photos img{max-width:48%;max-height:280px;border-radius:8px;object-fit:cover}p{font-size:15px;line-height:1.6}.who{color:#9A9AA1;font-size:12px}</style></head>
<body><div class="cover"><h1>${esc(title)}</h1><p>${rows.length} ${ar ? 'ذكرى' : rows.length === 1 ? 'memory' : 'memories'}</p></div>${entries}</body></html>`;
    return { html, count: rows.length, title };
  });
}
