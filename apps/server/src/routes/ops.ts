import { approvalLimit, fromZoned, localDayKey, lowStockChange, schemas, type GroupPolicy, type Role } from '@circle/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { assetServices, assets, contacts, groupMembers, groups, inventoryItems, inventoryMoves, spendRequests, tasks } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { registerJob } from '../jobs';

// Operations (v3.6, A6 Company): inventory with low-stock alerts and reorders, assets & maintenance, spend approvals with
// limits per role. B9: a low-stock alert fires once per threshold crossing; approval limits apply per role.

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function managers(db: DbOrTx, groupId: string, except?: string) {
  return (await db.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).filter((m) => ['owner', 'admin', 'manager'].includes(m.role) && m.u !== except).map((m) => m.u);
}

/** Maintenance due → one task per asset per due date (dedupe key), on the morning it's due. */
async function scheduleService(db: DbOrTx, asset: typeof assets.$inferSelect, tz: string) {
  if (!asset.nextServiceDay) return;
  const [y, m, d] = asset.nextServiceDay.split('-').map(Number);
  const at = fromZoned({ year: y, month: m, day: d, hour: 8, minute: 0 }, tz);
  await enqueueJob(db, { kind: 'asset_service_due', payload: { assetId: asset.id, day: asset.nextServiceDay }, runAt: new Date(at), dedupeKey: `asset_service:${asset.id}:${asset.nextServiceDay}` });
}

registerJob('asset_service_due', async (deps, p) => {
  const [a] = await deps.db.select().from(assets).where(eq(assets.id, p.assetId));
  if (!a || !a.active || a.nextServiceDay !== p.day) return; // serviced or rescheduled since
  await deps.db.insert(tasks).values({ id: newId(), groupId: a.groupId, title: `Service: ${a.name}`, createdBy: 'system', notes: `${a.location ? `${a.location} · ` : ''}due ${a.nextServiceDay}`, dueAt: deps.clock() });
  await notify(deps.db, { userIds: await managers(deps.db, a.groupId), groupId: a.groupId, kind: 'asset_service', title: `🛠️ ${a.name}`, body: 'Service is due today', data: { href: `/g/${a.groupId}/assets` }, now: deps.clock() });
});

export function registerOpsRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';

  // ── inventory ───────────────────────────────────────────────────────────────
  const inv = { module: 'inventory', tags: ['inventory'] };
  async function memberOk(groupId: string, userId: string | null | undefined) {
    if (!userId) return true;
    return (await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))).length > 0;
  }
  async function contactOk(groupId: string, contactId: string | null | undefined) {
    if (!contactId) return true;
    return (await db.select().from(contacts).where(and(eq(contacts.groupId, groupId), eq(contacts.id, contactId)))).length > 0;
  }

  r.get(`${base}/inventory`, { ...inv, perm: 'items.read', summary: 'Stock list (low items first)' }, async (c) => {
    const rows = await db.select().from(inventoryItems).where(and(eq(inventoryItems.groupId, c.get('group').id), eq(inventoryItems.active, true))).orderBy(desc(inventoryItems.low), asc(inventoryItems.name));
    return rows;
  });

  r.post(`${base}/inventory`, { ...inv, perm: 'items.manage', summary: 'Add a stock item with its low-stock threshold', body: schemas.inventoryCreate }, async (c, { body }) => {
    const group = c.get('group');
    if (!(await memberOk(group.id, body.vendorUserId)) || !(await contactOk(group.id, body.vendorContactId))) throw badRequest('bad_vendor');
    const [row] = await db.insert(inventoryItems).values({ id: newId(), groupId: group.id, name: body.name, unit: body.unit, quantity: body.quantity, lowAt: body.lowAt, low: body.quantity <= body.lowAt, vendorUserId: body.vendorUserId ?? null, vendorContactId: body.vendorContactId ?? null, createdAt: deps.clock() }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'inventory' });
    return row;
  });

  /** Every stock change goes through here: one row lock, one move record, at most one alert per crossing. */
  async function changeStock(c: Ctx, next: (q: number) => number, reason: string | undefined) {
    const group = c.get('group');
    const user = c.get('user');
    const res = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.id, c.req.param('itemId')!), eq(inventoryItems.groupId, group.id), eq(inventoryItems.active, true))).for('update');
      if (!item) throw notFound();
      const quantity = next(item.quantity);
      if (quantity < 0) throw conflict('not_enough_stock');
      const change = lowStockChange(item, quantity);
      const [row] = await tx.update(inventoryItems).set({ quantity, low: change.low }).where(eq(inventoryItems.id, item.id)).returning();
      await tx.insert(inventoryMoves).values({ id: newId(), itemId: item.id, groupId: group.id, delta: quantity - item.quantity, after: quantity, reason: reason ?? null, userId: user.id, at: deps.clock() });
      if (change.alert)
        await notify(tx, { userIds: await managers(tx, group.id), groupId: group.id, kind: 'low_stock', title: `📦 Low stock: ${item.name}`, body: `${quantity} ${item.unit} left (alert at ${item.lowAt})`.trim(), data: { itemId: item.id, href: `/g/${group.id}/inventory` }, now: deps.clock() });
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'inventory' });
    return res;
  }
  r.post(`${base}/inventory/:itemId/move`, { ...inv, perm: 'items.read', summary: 'Use or restock (+/−)', body: schemas.inventoryMove }, (c, { body }) => changeStock(c, (q) => q + body.delta, body.reason));
  r.post(`${base}/inventory/:itemId/count`, { ...inv, perm: 'items.manage', summary: 'Set the counted quantity', body: schemas.inventoryCount }, (c, { body }) => changeStock(c, () => body.quantity, 'count'));

  r.get(`${base}/inventory/:itemId/moves`, { ...inv, perm: 'items.read', summary: 'Stock history' }, async (c) => {
    const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, c.req.param('itemId')!), eq(inventoryItems.groupId, c.get('group').id)));
    if (!item) throw notFound();
    return db.select().from(inventoryMoves).where(eq(inventoryMoves.itemId, item.id)).orderBy(desc(inventoryMoves.at)).limit(100);
  });

  /** "Reorder" becomes a task for the vendor (their member account, or a task naming the vendor contact). */
  r.post(`${base}/inventory/:itemId/reorder`, { ...inv, perm: 'items.manage', summary: 'Reorder → a task for the vendor', body: schemas.reorder }, async (c, { body }) => {
    const group = c.get('group');
    const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, c.req.param('itemId')!), eq(inventoryItems.groupId, group.id), eq(inventoryItems.active, true)));
    if (!item) throw notFound();
    const [vendor] = item.vendorContactId ? await db.select().from(contacts).where(eq(contacts.id, item.vendorContactId)) : [];
    const [t] = await db
      .insert(tasks)
      .values({ id: newId(), groupId: group.id, title: `Reorder ${body.quantity} ${item.unit} ${item.name}`.replace(/\s+/g, ' '), assigneeId: item.vendorUserId, createdBy: c.get('user').id, notes: vendor ? `Vendor: ${vendor.name}${vendor.phone ? ` · ${vendor.phone}` : ''}` : null })
      .returning();
    if (item.vendorUserId) await notify(db, { userIds: [item.vendorUserId], groupId: group.id, kind: 'task_assigned', title: t.title, body: group.name, data: { taskId: t.id }, now: deps.clock() });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'tasks' });
    return t;
  });

  // ── assets & maintenance ────────────────────────────────────────────────────
  const as = { module: 'assets', tags: ['assets'] };
  r.get(`${base}/assets`, { ...as, perm: 'items.read', summary: 'Equipment with next service dates' }, async (c) => {
    return db.select().from(assets).where(and(eq(assets.groupId, c.get('group').id), eq(assets.active, true))).orderBy(asc(assets.nextServiceDay), asc(assets.name));
  });

  r.post(`${base}/assets`, { ...as, perm: 'items.manage', summary: 'Add equipment and its service schedule', body: schemas.assetCreate }, async (c, { body }) => {
    const group = c.get('group');
    if (!(await contactOk(group.id, body.vendorContactId))) throw badRequest('bad_vendor');
    const today = localDayKey(deps.clock().getTime(), group.timezone);
    const next = body.serviceEveryDays ? addDays(body.lastServiceDay ?? today, body.serviceEveryDays) : null;
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.insert(assets).values({ id: newId(), groupId: group.id, name: body.name, location: body.location, serial: body.serial, serviceEveryDays: body.serviceEveryDays, lastServiceDay: body.lastServiceDay ?? null, nextServiceDay: next, vendorContactId: body.vendorContactId ?? null, createdAt: deps.clock() }).returning();
      await scheduleService(tx, a, group.timezone);
      return a;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'assets' });
    return row;
  });

  r.post(`${base}/assets/:assetId/service`, { ...as, perm: 'items.read', summary: 'Log a service; the next one is scheduled', body: schemas.assetService }, async (c, { body }) => {
    const group = c.get('group');
    const res = await db.transaction(async (tx) => {
      const [a] = await tx.select().from(assets).where(and(eq(assets.id, c.req.param('assetId')!), eq(assets.groupId, group.id), eq(assets.active, true))).for('update');
      if (!a) throw notFound();
      const day = body.day ?? localDayKey(deps.clock().getTime(), group.timezone);
      await tx.insert(assetServices).values({ id: newId(), assetId: a.id, groupId: group.id, day, note: body.note, costMinor: body.costMinor, userId: c.get('user').id, createdAt: deps.clock() });
      const [row] = await tx.update(assets).set({ lastServiceDay: day, nextServiceDay: a.serviceEveryDays ? addDays(day, a.serviceEveryDays) : null }).where(eq(assets.id, a.id)).returning();
      await scheduleService(tx, row, group.timezone);
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'serviced', entity: 'asset', entityId: a.id, summary: a.name });
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'assets' });
    return res;
  });

  r.get(`${base}/assets/:assetId/services`, { ...as, perm: 'items.read', summary: 'Service history' }, async (c) => {
    const [a] = await db.select().from(assets).where(and(eq(assets.id, c.req.param('assetId')!), eq(assets.groupId, c.get('group').id)));
    if (!a) throw notFound();
    return db.select().from(assetServices).where(eq(assetServices.assetId, a.id)).orderBy(desc(assetServices.day));
  });

  // ── spend approvals with limits per role ────────────────────────────────────
  const ap = { module: 'approvals', tags: ['approvals'] };
  const policy = (c: Ctx) => c.get('group').settings as GroupPolicy & { approvalLimits?: Record<string, number> };
  const myLimit = (c: Ctx) => approvalLimit(policy(c), c.get('member').role as Role, c.get('member').customRoleId);

  r.get(`${base}/spend-requests`, { ...ap, perm: 'items.read', summary: 'Spend requests (mine; all of them for approvers) and the limits' }, async (c) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const approver = actorCan(c, 'approve');
    const rows = await db.select().from(spendRequests).where(eq(spendRequests.groupId, group.id)).orderBy(desc(spendRequests.createdAt)).limit(300);
    return { requests: approver ? rows : rows.filter((x) => x.requesterId === me), limits: policy(c).approvalLimits ?? {}, myLimit: Number.isFinite(myLimit(c)) ? myLimit(c) : null };
  });

  r.post(`${base}/spend-requests`, { ...ap, perm: 'items.read', summary: 'Ask to spend (approved at once when within my own limit)', body: schemas.spendRequest }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const auto = body.amount <= myLimit(c);
    const row = await db.transaction(async (tx) => {
      const [req] = await tx
        .insert(spendRequests)
        .values({ id: newId(), groupId: group.id, requesterId: me, title: body.title, amountMinor: body.amount, category: body.category, note: body.note ?? null, status: auto ? 'approved' : 'pending', decidedBy: auto ? 'auto' : null, decidedAt: auto ? deps.clock() : null, createdAt: deps.clock() })
        .returning();
      if (!auto) await notify(tx, { userIds: await managers(tx, group.id, me), groupId: group.id, kind: 'spend_request', title: '✅ Approval needed', body: `${c.get('member').displayName}: ${body.title} · ${(body.amount / 100).toFixed(2)} ${group.currency}`, data: { href: `/g/${group.id}/approvals` }, now: deps.clock() });
      return req;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'approvals' });
    return row;
  });

  for (const action of ['approve', 'reject'] as const) {
    r.post(`${base}/spend-requests/:requestId/${action}`, { ...ap, perm: 'approve', summary: action === 'approve' ? 'Approve (only up to my own limit)' : 'Turn down' }, async (c) => {
      const group = c.get('group');
      const me = c.get('user').id;
      const res = await db.transaction(async (tx) => {
        const [req] = await tx.select().from(spendRequests).where(and(eq(spendRequests.id, c.req.param('requestId')!), eq(spendRequests.groupId, group.id))).for('update');
        if (!req) throw notFound();
        if (req.status !== 'pending') throw conflict('already_decided');
        if (req.requesterId === me) throw forbidden('own_request');
        if (action === 'approve' && req.amountMinor > myLimit(c)) throw forbidden('over_your_limit');
        const [row] = await tx.update(spendRequests).set({ status: action === 'approve' ? 'approved' : 'rejected', decidedBy: me, decidedAt: deps.clock() }).where(eq(spendRequests.id, req.id)).returning();
        await notify(tx, { userIds: [req.requesterId], groupId: group.id, kind: 'spend_decided', title: action === 'approve' ? '✅ Approved' : 'Not approved', body: req.title, data: { href: `/g/${group.id}/approvals` }, now: deps.clock() });
        return row;
      });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'approvals' });
      return res;
    });
  }

  r.put(`${base}/spend-requests/limits`, { ...ap, perm: 'group.settings', summary: 'Spending / approval limit per role or custom role (minor units)', body: schemas.approvalLimits }, async (c, { body }) => {
    const group = c.get('group');
    const settings = group.settings as Record<string, unknown>;
    await db.update(groups).set({ settings: { ...settings, approvalLimits: body.limits } }).where(eq(groups.id, group.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'group' });
    return { limits: body.limits };
  });
}

