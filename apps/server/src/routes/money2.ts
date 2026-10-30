import { fromZoned, localDayKey, schemas, type Role } from '@circle/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AiRefusal } from '../ai';
import type { DbOrTx } from '../db/client';
import { budgetAlerts, budgets, contacts, dueCharges, dues, expenses, files, groupMembers, groups, guestLinks, invitees } from '../db/schema';
import type { Deps } from '../deps';
import { enqueueJob, logActivity, notify } from '../effects';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { emit, type Ctx, type Router } from '../http';
import { newId, newToken } from '../ids';
import { registerJob } from '../jobs';
import { assertNotChild } from './children';
import { expenseHooks } from './expenses';

export const BUDGET_THRESHOLDS = [80, 100] as const;

async function moneyReaders(tx: DbOrTx, groupId: string) {
  return (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, groupId)))
    .filter((m) => ['owner', 'admin', 'manager', 'member'].includes(m.role))
    .map((m) => m.u);
}

/** Budget alerts: checked in the same transaction as each new expense; the (budget, period, threshold) row makes each alert fire once. */
expenseHooks.push(async (tx, deps, e) => {
  const [group] = await tx.select().from(groups).where(eq(groups.id, e.groupId));
  if (!group || !group.modules.includes('budgets')) return;
  const bs = (await tx.select().from(budgets).where(eq(budgets.groupId, e.groupId))).filter((b) => b.category === '*' || b.category === e.category);
  if (!bs.length) return;
  const all = await tx.select().from(expenses).where(and(eq(expenses.groupId, e.groupId), isNull(expenses.reversedAt)));
  for (const b of bs) {
    const periodKey = b.period === 'month' ? localDayKey(e.spentAt.getTime(), group.timezone).slice(0, 7) : 'total';
    const spent = all
      .filter((x) => b.category === '*' || x.category === b.category)
      .filter((x) => b.period !== 'month' || localDayKey(x.spentAt.getTime(), group.timezone).slice(0, 7) === periodKey)
      .reduce((s, x) => s + x.amountMinor, 0);
    for (const th of BUDGET_THRESHOLDS) {
      if (spent * 100 < b.amountMinor * th) continue;
      const fresh = await tx.insert(budgetAlerts).values({ budgetId: b.id, periodKey, threshold: th }).onConflictDoNothing().returning();
      if (!fresh.length) continue;
      await notify(tx, {
        userIds: await moneyReaders(tx, e.groupId),
        groupId: e.groupId,
        kind: 'budget_alert',
        title: `🎯 ${b.category === '*' ? 'Budget' : b.category}: ${th}%`,
        body: `${(spent / 100).toFixed(2)} of ${(b.amountMinor / 100).toFixed(2)} ${group.currency}`,
        data: { budgetId: b.id, threshold: th, periodKey, href: `/g/${e.groupId}/expenses` },
        now: deps.clock(),
      });
    }
  }
});

function periodKeyFor(period: string, now: number, tz: string) {
  return period === 'monthly' ? localDayKey(now, tz).slice(0, 7) : 'once';
}

async function ensureCharges(tx: DbOrTx, deps: Deps, due: typeof dues.$inferSelect, tz: string) {
  if (!due.active || due.unitBased) return;
  const periodKey = periodKeyFor(due.period, deps.clock().getTime(), tz);
  const members = await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, due.groupId));
  const payers = due.memberIds.length ? members.filter((m) => due.memberIds.includes(m.u)) : members.filter((m) => ['owner', 'admin', 'manager', 'member'].includes(m.role as Role));
  if (!payers.length) return;
  const created = await tx
    .insert(dueCharges)
    .values(payers.map((p) => ({ id: newId(), dueId: due.id, groupId: due.groupId, payerKey: p.u, periodKey, amountMinor: due.amountMinor })))
    .onConflictDoNothing()
    .returning();
  if (created.length && due.period === 'monthly') {
    // reminder the day before the due day, 09:00 group time
    const [y, m] = periodKey.split('-').map(Number);
    const at = fromZoned({ year: y, month: m, day: Math.max(1, due.dueDay - 1), hour: 9, minute: 0 }, tz);
    if (at > deps.clock().getTime()) await enqueueJob(tx, { kind: 'dues_reminder', payload: { dueId: due.id, periodKey }, runAt: new Date(at), dedupeKey: `dues_reminder:${due.id}:${periodKey}` });
  }
  if (due.period === 'monthly') {
    // next month's board (and its reminder) appears on the 1st even if nobody opens the screen
    const [y, m] = periodKey.split('-').map(Number);
    const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
    const at = fromZoned({ ...next, day: 1, hour: 0, minute: 5 }, tz);
    await enqueueJob(tx, { kind: 'dues_roll', payload: { dueId: due.id }, runAt: new Date(at), dedupeKey: `dues_roll:${due.id}:${next.year}-${next.month}` });
  }
}

registerJob('dues_roll', async (deps, p) => {
  const [due] = await deps.db.select().from(dues).where(eq(dues.id, p.dueId));
  if (!due || !due.active) return;
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, due.groupId));
  if (group) await ensureCharges(deps.db, deps, due, group.timezone);
});

registerJob('dues_reminder', async (deps, p) => {
  const unpaid = await deps.db.select().from(dueCharges).where(and(eq(dueCharges.dueId, p.dueId), eq(dueCharges.periodKey, p.periodKey), isNull(dueCharges.paidAt), isNull(dueCharges.reportedAt)));
  const [due] = await deps.db.select().from(dues).where(eq(dues.id, p.dueId));
  if (!due || !due.active) return;
  await notify(deps.db, { userIds: unpaid.map((c) => c.payerKey), groupId: due.groupId, kind: 'dues_reminder', title: `🧾 ${due.title}`, body: `${(due.amountMinor / 100).toFixed(2)} due tomorrow`, data: { dueId: due.id, periodKey: p.periodKey, href: `/g/${due.groupId}/dues` }, now: deps.clock() });
});

export function registerMoney2Routes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';

  // ── budgets ─────────────────────────────────────────────────────────────────
  const bd = { module: 'budgets', tags: ['budgets'] };
  r.get(`${base}/budgets`, { ...bd, perm: 'money.read', summary: 'Budgets with spending this period' }, async (c) => {
    const group = c.get('group');
    const bs = await db.select().from(budgets).where(eq(budgets.groupId, group.id));
    const all = await db.select().from(expenses).where(and(eq(expenses.groupId, group.id), isNull(expenses.reversedAt)));
    const month = localDayKey(deps.clock().getTime(), group.timezone).slice(0, 7);
    return bs.map((b) => {
      const spent = all
        .filter((x) => b.category === '*' || x.category === b.category)
        .filter((x) => b.period !== 'month' || localDayKey(x.spentAt.getTime(), group.timezone).slice(0, 7) === month)
        .reduce((s, x) => s + x.amountMinor, 0);
      return { ...b, spent, percent: b.amountMinor ? Math.round((spent / b.amountMinor) * 100) : 0 };
    });
  });
  r.post(`${base}/budgets`, { ...bd, perm: 'group.settings', summary: 'Set a budget for a category (* = everything)', body: schemas.budgetCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [row] = await db.insert(budgets).values({ id: newId(), groupId: group.id, category: body.category, amountMinor: body.amount, period: body.period, createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'budgets' });
    return row;
  });
  r.delete(`${base}/budgets/:budgetId`, { ...bd, perm: 'group.settings', summary: 'Remove a budget' }, async (c) => {
    const res = await db.delete(budgets).where(and(eq(budgets.id, c.req.param('budgetId')!), eq(budgets.groupId, c.get('group').id))).returning();
    if (!res.length) throw notFound();
    emit(c, { type: 'invalidate', groupId: res[0].groupId, entity: 'budgets' });
    return { ok: true };
  });

  // ── dues ────────────────────────────────────────────────────────────────────
  const du = { module: 'dues', tags: ['dues'] };
  r.get(`${base}/dues`, { ...du, perm: 'money.read', summary: 'Dues with this period’s paid / unpaid board' }, async (c) => {
    const group = c.get('group');
    const ds = await db.select().from(dues).where(and(eq(dues.groupId, group.id), eq(dues.active, true))).orderBy(desc(dues.createdAt));
    for (const d of ds) await ensureCharges(db, deps, d, group.timezone);
    const charges = ds.length ? await db.select().from(dueCharges).where(inArray(dueCharges.dueId, ds.map((d) => d.id))) : [];
    return ds.map((d) => {
      const pk = periodKeyFor(d.period, deps.clock().getTime(), group.timezone);
      const board = charges.filter((x) => x.dueId === d.id && x.periodKey === pk).map((x) => ({ ...x, status: x.paidAt ? 'paid' : x.reportedAt ? 'reported' : 'unpaid' }));
      return { ...d, periodKey: pk, board, collected: board.filter((b) => b.paidAt).reduce((s, b) => s + b.amountMinor, 0) };
    });
  });
  r.post(`${base}/dues`, { ...du, perm: 'approve', summary: 'Start collecting a fee', body: schemas.dueCreate }, async (c, { body }) => {
    const group = c.get('group');
    const row = await db.transaction(async (tx) => {
      const [d] = await tx.insert(dues).values({ id: newId(), groupId: group.id, title: body.title, amountMinor: body.amount, period: body.period, dueDay: body.dueDay, memberIds: body.memberIds ?? [], createdBy: c.get('user').id }).returning();
      await ensureCharges(tx, deps, d, group.timezone);
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'created', entity: 'due', entityId: d.id, summary: d.title });
      return d;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'dues' });
    return row;
  });

  async function charge(c: Ctx) {
    const [ch] = await db.select().from(dueCharges).where(and(eq(dueCharges.id, c.req.param('chargeId')!), eq(dueCharges.dueId, c.req.param('dueId')!), eq(dueCharges.groupId, c.get('group').id)));
    if (!ch) throw notFound();
    return ch;
  }
  r.post(`${base}/dues/:dueId/charges/:chargeId/report`, { ...du, perm: 'money.read', summary: '"I paid" — waits for the collector to confirm' }, async (c) => {
    const ch = await charge(c);
    if (ch.payerKey !== c.get('user').id) throw forbidden();
    await db.update(dueCharges).set({ reportedAt: deps.clock() }).where(eq(dueCharges.id, ch.id));
    emit(c, { type: 'invalidate', groupId: ch.groupId, entity: 'dues' });
    return { ok: true };
  });
  r.post(`${base}/dues/:dueId/charges/:chargeId/confirm`, { ...du, perm: 'approve', summary: 'Collector confirms a payment' }, async (c) => {
    const ch = await charge(c);
    if (ch.paidAt) return { ok: true };
    await db.transaction(async (tx) => {
      await tx.update(dueCharges).set({ paidAt: deps.clock(), confirmedBy: c.get('user').id }).where(eq(dueCharges.id, ch.id));
      await logActivity(tx, { groupId: ch.groupId, actorId: c.get('user').id, verb: 'confirmed', entity: 'due_charge', entityId: ch.id, summary: String(ch.amountMinor) });
    });
    emit(c, { type: 'invalidate', groupId: ch.groupId, entity: 'dues' });
    return { ok: true };
  });

  // ── contacts ────────────────────────────────────────────────────────────────
  const ct = { module: 'contacts', tags: ['contacts'] };
  r.get(`${base}/contacts`, { ...ct, perm: 'items.read', summary: 'Group directory (vendors, doctors, emergency numbers)' }, async (c) => {
    return db.select().from(contacts).where(eq(contacts.groupId, c.get('group').id)).orderBy(contacts.kind, contacts.name);
  });
  r.post(`${base}/contacts`, { ...ct, perm: 'items.create', summary: 'Add a contact', body: schemas.contactCreate }, async (c, { body }) => {
    const [row] = await db.insert(contacts).values({ id: newId(), groupId: c.get('group').id, ...body, createdBy: c.get('user').id }).returning();
    emit(c, { type: 'invalidate', groupId: row.groupId, entity: 'contacts' });
    return row;
  });
  r.delete(`${base}/contacts/:contactId`, { ...ct, perm: 'items.create', summary: 'Remove a contact' }, async (c) => {
    const res = await db.delete(contacts).where(and(eq(contacts.id, c.req.param('contactId')!), eq(contacts.groupId, c.get('group').id))).returning();
    if (!res.length) throw notFound();
    emit(c, { type: 'invalidate', groupId: res[0].groupId, entity: 'contacts' });
    return { ok: true };
  });

  // ── guest list (each invitee gets a guest link; RSVP with plus-ones without the app) ─────
  const gl = { module: 'guests', tags: ['guests'] };
  r.get(`${base}/guests`, { ...gl, perm: 'items.read', summary: 'Guest list with headcount (plus-ones counted)' }, async (c) => {
    const group = c.get('group');
    const rows = await db.select().from(invitees).where(eq(invitees.groupId, group.id)).orderBy(invitees.name);
    const links = rows.length ? await db.select().from(guestLinks).where(and(eq(guestLinks.groupId, group.id), eq(guestLinks.entity, 'invitee'), isNull(guestLinks.revokedAt))) : [];
    return { guests: rows.map((g) => ({ ...g, url: links.find((l) => l.entityId === g.id) ? `${deps.env.publicUrl}/p/${links.find((l) => l.entityId === g.id)!.token}` : null })), totals: inviteeTotals(rows) };
  });
  r.post(`${base}/guests`, { ...gl, perm: 'items.create', summary: 'Invite someone (creates their RSVP link)', body: schemas.guestCreate }, async (c, { body }) => {
    const group = c.get('group');
    const row = await db.transaction(async (tx) => {
      const [g] = await tx.insert(invitees).values({ id: newId(), groupId: group.id, name: body.name, phone: body.phone ?? null, maxPlusOnes: body.maxPlusOnes, createdBy: c.get('user').id }).returning();
      const [link] = await tx.insert(guestLinks).values({ id: newId(), groupId: group.id, token: newToken(18), entity: 'invitee', entityId: g.id, createdBy: c.get('user').id }).returning();
      return { ...g, url: `${deps.env.publicUrl}/p/${link.token}` };
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'guests' });
    return row;
  });
  r.delete(`${base}/guests/:guestId`, { ...gl, perm: 'items.create', summary: 'Remove an invitee (their link stops working)' }, async (c) => {
    const group = c.get('group');
    const res = await db.delete(invitees).where(and(eq(invitees.id, c.req.param('guestId')!), eq(invitees.groupId, group.id))).returning();
    if (!res.length) throw notFound();
    await db.update(guestLinks).set({ revokedAt: deps.clock() }).where(and(eq(guestLinks.entity, 'invitee'), eq(guestLinks.entityId, res[0].id)));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'guests' });
    return { ok: true };
  });

  // ── receipt scan (AI, draft only) ───────────────────────────────────────────
  r.post(`${base}/ai/receipt`, { module: 'expenses', perm: 'money.write', tags: ['ai'], summary: 'Receipt photo → draft expense (not saved)', body: schemas.aiReceipt }, async (c, { body }) => {
    assertNotChild(c);
    if (!deps.ai) throw new HttpError(503, 'ai_disabled');
    const group = c.get('group');
    const [f] = await db.select().from(files).where(and(eq(files.id, body.fileId), eq(files.groupId, group.id)));
    if (!f || !f.uploadedAt || !f.mime.startsWith('image/') || f.encrypted) throw badRequest('bad_file');
    const bytes = await deps.storage.get(f.key);
    if (!bytes) throw notFound();
    const schema = z.object({ title: z.string().max(120), total: z.number().int().nonnegative(), currency: z.string().length(3).nullable(), items: z.array(z.object({ name: z.string().max(80), amount: z.number().int() })).max(50) });
    try {
      const draft = await deps.ai.json('receipt', {
        system: `Read this receipt. Amounts are integer minor units (piasters/cents). The group's currency is ${group.currency}; return currency null if the receipt is in it.`,
        prompt: 'Extract the shop name as title, the total, the currency and the line items.',
        schema,
        image: { mime: f.mime, base64: Buffer.from(bytes).toString('base64') },
      });
      return { draft: { ...draft, currency: draft.currency ?? group.currency }, saved: false };
    } catch (e) {
      if (e instanceof AiRefusal) throw new HttpError(422, 'ai_declined');
      if (e instanceof z.ZodError) throw new HttpError(422, 'ai_bad_output');
      throw e;
    }
  });

}

export function inviteeTotals(rows: { status: string; plusOnes: number }[]) {
  const going = rows.filter((g) => g.status === 'going');
  return {
    invited: rows.length,
    going: going.length,
    maybe: rows.filter((g) => g.status === 'maybe').length,
    no: rows.filter((g) => g.status === 'no').length,
    pending: rows.filter((g) => g.status === 'invited').length,
    /** guests coming including their plus-ones (B9 v2.0) */
    headcount: going.reduce((s, g) => s + 1 + g.plusOnes, 0),
  };
}

export async function inviteeRsvp(deps: Deps, token: string, body: z.infer<typeof schemas.guestRsvp>) {
  const [link] = await deps.db.select().from(guestLinks).where(and(eq(guestLinks.token, token), eq(guestLinks.entity, 'invitee'), isNull(guestLinks.revokedAt)));
  if (!link) throw notFound();
  const [g] = await deps.db.select().from(invitees).where(and(eq(invitees.id, link.entityId), eq(invitees.groupId, link.groupId)));
  if (!g) throw notFound();
  const plusOnes = body.status === 'going' ? Math.min(body.plusOnes, g.maxPlusOnes) : 0;
  const [row] = await deps.db.update(invitees).set({ status: body.status, plusOnes, dietary: body.dietary ?? g.dietary, respondedAt: deps.clock() }).where(eq(invitees.id, g.id)).returning();
  await logActivity(deps.db, { groupId: g.groupId, actorId: null, verb: 'rsvp', entity: 'invitee', entityId: g.id, summary: `${g.name}: ${body.status}${plusOnes ? ` +${plusOnes}` : ''}` });
  deps.bus.publish({ type: 'invalidate', groupId: g.groupId, entity: 'guests' });
  return row;
}
