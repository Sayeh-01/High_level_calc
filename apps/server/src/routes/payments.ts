import { paymentQuote, schemas, simplifyDebts } from '@circle/shared';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { dueCharges, dues, gameyaPayments, gameyaSlots, groupMembers, groups, paymentEvents, payments, receipts, settlements } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { FAKE_SIGNATURE_HEADER, fakeOutcome, signWebhook, type WebhookEvent } from '../payments/provider';
import { assertNotChild } from './children';
import { groupLedger } from './expenses';
import { confirmShare } from './gameya';
import { esc } from './guest';

// Payments through a gateway (A12 stage 2, B4, B9 v2.6). The client only says WHAT it pays (a due, a gam'eya share, a
// debt); the server prices it, adds the fee, opens a checkout with the provider, and changes balances only when a signed
// webhook says the money moved. Each webhook event id is stored once, so a repeated delivery changes nothing.

const fmt = (minor: number) => (minor / 100).toFixed(2);

type Payment = typeof payments.$inferSelect;

/** What the payment is for, and who receives it. Throws when the target isn't payable by this member. */
async function resolveTarget(db: DbOrTx, groupId: string, payerId: string, body: z.infer<typeof schemas.paymentCreate>) {
  if (body.purpose === 'due') {
    const [ch] = await db.select().from(dueCharges).where(and(eq(dueCharges.id, body.targetId), eq(dueCharges.groupId, groupId)));
    if (!ch) throw notFound();
    if (ch.payerKey !== payerId) throw forbidden();
    if (ch.paidAt) throw conflict('already_paid');
    const [d] = await db.select().from(dues).where(eq(dues.id, ch.dueId));
    if (d.createdBy === payerId) throw badRequest('pay_yourself');
    return { payeeId: d.createdBy, amount: ch.amountMinor, description: `${d.title} (${ch.periodKey})` };
  }
  if (body.purpose === 'gameya') {
    const [p] = await db.select().from(gameyaPayments).where(and(eq(gameyaPayments.id, body.targetId), eq(gameyaPayments.groupId, groupId)));
    if (!p) throw notFound();
    if (p.payerId !== payerId) throw forbidden();
    if (p.confirmedAt) throw conflict('already_paid');
    const [slot] = await db.select().from(gameyaSlots).where(and(eq(gameyaSlots.gameyaId, p.gameyaId), eq(gameyaSlots.position, p.position)));
    if (slot.userId === payerId) throw badRequest('pay_yourself');
    return { payeeId: slot.userId, amount: p.amountMinor, description: `Gam'eya month ${p.position}` };
  }
  // settlement: pay part or all of what I owe another member (by the simplified transfers)
  if (body.targetId === payerId) throw badRequest('pay_yourself');
  const [m] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, body.targetId)));
  if (!m) throw badRequest('not_a_member');
  const owed = simplifyDebts((await groupLedger(db, groupId)).balances).find((x) => x.from === payerId && x.to === body.targetId)?.amount ?? 0;
  if (body.amount > owed) throw badRequest('more_than_owed', undefined, { owed });
  return { payeeId: body.targetId, amount: body.amount, description: `Settle up with ${m.displayName}` };
}

/** Applies a successful payment to what it paid for. Runs once per payment, inside the webhook transaction. */
async function applySuccess(tx: DbOrTx, deps: Deps, p: Payment) {
  const now = deps.clock();
  if (p.purpose === 'due') {
    const done = await tx.update(dueCharges).set({ paidAt: now, confirmedBy: 'gateway' }).where(and(eq(dueCharges.id, p.targetId), isNull(dueCharges.paidAt))).returning();
    return done.length > 0;
  }
  if (p.purpose === 'gameya') {
    const [gp] = await tx.select().from(gameyaPayments).where(eq(gameyaPayments.id, p.targetId));
    if (gp.confirmedAt) return false;
    await confirmShare(tx, deps, gp.id, 'gateway');
    return true;
  }
  await tx.insert(settlements).values({ id: newId(), groupId: p.groupId, fromId: p.payerId, toId: p.payeeId, amountMinor: p.amountMinor, method: 'gateway', note: `payment ${p.id}`, confirmedAt: now });
  return true;
}

async function issueReceipt(tx: DbOrTx, p: Payment, now: Date) {
  const [r] = await tx.insert(receipts).values({ id: newId(), paymentId: p.id, groupId: p.groupId, number: 'pending', issuedAt: now }).onConflictDoNothing().returning();
  if (!r) return;
  await tx.update(receipts).set({ number: `CIR-${now.getUTCFullYear()}-${String(r.seq).padStart(6, '0')}` }).where(eq(receipts.id, r.id));
}

/** The webhook: verify → store the event once → move the payment to its final state → apply it. */
export async function handlePaymentWebhook(deps: Deps, providerId: string, rawBody: string, headers: Headers) {
  const provider = deps.payments;
  if (!provider || provider.id !== providerId) return { status: 404 as const, body: { error: 'not_found' } };
  const now = deps.clock();
  const event = provider.verifyWebhook(rawBody, headers, now);
  if (!event) return { status: 400 as const, body: { error: 'bad_signature' } };
  const result = await deps.db.transaction(async (tx) => {
    const fresh = await tx
      .insert(paymentEvents)
      .values({ id: newId(), provider: provider.id, providerEventId: event.id, type: event.type, paymentId: null, payload: event, receivedAt: now })
      .onConflictDoNothing()
      .returning();
    if (!fresh.length) return { duplicate: true as const };
    const [p] = await tx.select().from(payments).where(and(eq(payments.provider, provider.id), eq(payments.providerRef, event.providerRef))).for('update');
    if (!p) return { unknown: true as const };
    await tx.update(paymentEvents).set({ paymentId: p.id }).where(eq(paymentEvents.id, fresh[0].id));
    if (p.status !== 'created') return { payment: p, changed: false };
    if (event.amountMinor !== p.totalMinor || event.currency !== p.currency) {
      const [row] = await tx.update(payments).set({ status: 'failed', failureCode: 'amount_mismatch' }).where(eq(payments.id, p.id)).returning();
      return { payment: row, changed: true };
    }
    if (event.type === 'payment.failed') {
      const [row] = await tx.update(payments).set({ status: 'failed', failureCode: event.failureCode ?? 'failed' }).where(eq(payments.id, p.id)).returning();
      await notify(tx, { userIds: [p.payerId], groupId: p.groupId, kind: 'payment_failed', title: '❌ Payment failed', body: `${fmt(p.totalMinor)} ${p.currency}: ${row.failureCode}`, data: { paymentId: p.id, href: `/g/${p.groupId}/payment/${p.id}` }, now });
      return { payment: row, changed: true };
    }
    const applied = await applySuccess(tx, deps, p);
    // paid twice for the same thing (two checkouts raced): kept as succeeded and flagged for a refund through the gateway
    const [row] = await tx.update(payments).set({ status: 'succeeded', paidAt: now, failureCode: applied ? null : 'duplicate_target' }).where(eq(payments.id, p.id)).returning();
    await issueReceipt(tx, row, now);
    await logActivity(tx, { groupId: p.groupId, actorId: p.payerId, verb: 'paid', entity: 'payment', entityId: p.id, summary: `${fmt(p.amountMinor)} ${p.currency} (${p.purpose})` });
    await notify(tx, { userIds: [p.payerId, p.payeeId], groupId: p.groupId, kind: 'payment_succeeded', title: '✅ Payment received', body: `${fmt(p.amountMinor)} ${p.currency}`, data: { paymentId: p.id, href: `/g/${p.groupId}/payment/${p.id}` }, now });
    return { payment: row, changed: true };
  });
  if ('payment' in result && result.changed) {
    for (const entity of ['payments', 'dues', 'gameya', 'balances']) deps.bus.publish({ type: 'invalidate', groupId: result.payment.groupId, entity });
  }
  return { status: 200 as const, body: { received: true, duplicate: 'duplicate' in result } };
}

export function registerPaymentRoutes(r: Router, deps: Deps, root: Hono) {
  const { db } = deps;
  const base = '/groups/:groupId';

  async function load(c: Ctx) {
    const [p] = await db.select().from(payments).where(and(eq(payments.id, c.req.param('paymentId')!), eq(payments.groupId, c.get('group').id)));
    if (!p) throw notFound();
    const me = c.get('user').id;
    // the payer, the payee and the group's collectors see a payment; nobody else
    if (p.payerId !== me && p.payeeId !== me && !actorCan(c, 'approve')) throw notFound();
    return p;
  }

  r.post(`${base}/payments`, { perm: 'money.read', tags: ['payments'], summary: 'Pay a due, a gam’eya share or a debt online (returns the checkout link)', body: schemas.paymentCreate }, async (c, { body }) => {
    assertNotChild(c);
    if (!deps.payments) throw new HttpError(503, 'payments_disabled');
    const group = c.get('group');
    const me = c.get('user').id;
    const target = await resolveTarget(db, group.id, me, body);
    const quote = paymentQuote(target.amount, deps.env.fee);
    const id = newId();
    const [row] = await db
      .insert(payments)
      .values({ id, groupId: group.id, payerId: me, payeeId: target.payeeId, purpose: body.purpose, targetId: body.targetId, amountMinor: quote.amount, feeMinor: quote.fee, totalMinor: quote.total, currency: group.currency, provider: deps.payments.id, createdAt: deps.clock() })
      .returning();
    const checkout = await deps.payments.createCheckout({ paymentId: id, amountMinor: quote.total, currency: group.currency, description: `${group.emoji} ${group.name} · ${target.description}`, returnUrl: `${deps.env.publicUrl}/g/${group.id}/payment/${id}` });
    await db.update(payments).set({ providerRef: checkout.providerRef }).where(eq(payments.id, id));
    return { payment: { ...row, providerRef: checkout.providerRef }, checkoutUrl: checkout.checkoutUrl, quote };
  });

  r.get(`${base}/payments`, { perm: 'money.read', tags: ['payments'], summary: 'Payments I made or received (all of them for collectors)' }, async (c) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const conds = [eq(payments.groupId, group.id)];
    if (!actorCan(c, 'approve')) conds.push(or(eq(payments.payerId, me), eq(payments.payeeId, me))!);
    return db.select().from(payments).where(and(...conds)).orderBy(desc(payments.createdAt)).limit(200);
  });

  r.get(`${base}/payments/:paymentId`, { perm: 'money.read', tags: ['payments'], summary: 'Payment status and receipt number' }, async (c) => {
    const p = await load(c);
    const [rc] = await db.select().from(receipts).where(eq(receipts.paymentId, p.id));
    return { ...p, receipt: rc ? { number: rc.number, issuedAt: rc.issuedAt } : null };
  });

  r.get(`${base}/payments/:paymentId/receipt`, { perm: 'money.read', tags: ['payments'], summary: 'Receipt (HTML, printable)', query: z.object({ lang: z.enum(['en', 'ar']).default('en') }) }, async (c, { query }) => {
    const group = c.get('group');
    const p = await load(c);
    const [rc] = await db.select().from(receipts).where(eq(receipts.paymentId, p.id));
    if (!rc) throw notFound('no_receipt');
    const names = await db.select({ u: groupMembers.userId, n: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const name = (u: string) => names.find((x) => x.u === u)?.n ?? '—';
    const ar = query.lang === 'ar';
    const L = ar ? RECEIPT.ar : RECEIPT.en;
    const money = (m: number) => new Intl.NumberFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { style: 'currency', currency: p.currency }).format(m / 100);
    const when = new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: group.timezone }).format(p.paidAt ?? rc.issuedAt);
    const rows = [
      [L.number, rc.number],
      [L.date, when],
      [L.group, `${group.emoji} ${group.name}`],
      [L.from, name(p.payerId)],
      [L.to, name(p.payeeId)],
      [L.for, L.purpose[p.purpose as keyof typeof L.purpose] ?? p.purpose],
      [L.amount, money(p.amountMinor)],
      [L.fee, money(p.feeMinor)],
      [L.total, money(p.totalMinor)],
      [L.via, `${p.provider} · ${p.providerRef ?? ''}`],
    ];
    const html = `<!doctype html><html lang="${query.lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(rc.number)}</title>
<style>body{font-family:-apple-system,"Segoe UI","Noto Naskh Arabic",sans-serif;color:#1C1C1E;max-width:520px;margin:24px auto;padding:0 16px}
h1{font-size:22px}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #eee;vertical-align:top}td:first-child{color:#66666D;width:40%}
.total td{font-weight:700;font-size:18px}.note{color:#9A9AA1;font-size:12px;margin-top:16px}</style></head>
<body><h1>✅ ${esc(L.title)}</h1><table>${rows.map(([k, v], i) => `<tr${i === 8 ? ' class="total"' : ''}><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<p class="note">${esc(L.note)}</p></body></html>`;
    return { number: rc.number, html };
  });

  // ── webhook (server-to-server; raw body for the signature) ──────────────────
  root.post('/api/webhooks/payments/:provider', async (c) => {
    const res = await handlePaymentWebhook(deps, c.req.param('provider'), await c.req.text(), c.req.raw.headers);
    return c.json(res.body, res.status);
  });

  // ── the fake gateway's hosted checkout (dev / tests / E2E only) ─────────────
  const fake = deps.payments?.id === 'fake' ? (deps.payments as unknown as { checkouts: Map<string, { ref: string; amountMinor: number; currency: string; description: string; returnUrl: string; done: boolean }>; secret: string }) : null;
  if (!fake) return;
  root.get('/fake-gateway/checkout/:ref', (c) => {
    const co = fake.checkouts.get(c.req.param('ref'));
    if (!co) return c.text('Unknown checkout', 404);
    const total = `${(co.amountMinor / 100).toFixed(2)} ${co.currency}`;
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fake gateway</title>
<style>body{font-family:-apple-system,sans-serif;max-width:420px;margin:40px auto;padding:0 16px}button{width:100%;padding:14px;font-size:17px;border:0;border-radius:10px;background:#2B59C3;color:#fff}.muted{color:#777;font-size:13px}</style></head>
<body><p class="muted">FAKE PAYMENT GATEWAY — no real money moves</p><h2 data-testid="fake-total">${esc(total)}</h2><p>${esc(co.description)}</p>
${co.done ? '<p>Already processed.</p>' : `<form method="post" action="/fake-gateway/checkout/${esc(co.ref)}/pay"><button data-testid="fake-pay">Pay ${esc(total)}</button></form>`}
<p class="muted">Test rule: totals ending in .13 are declined, .14 fail for insufficient funds.</p></body></html>`);
  });
  root.post('/fake-gateway/checkout/:ref/pay', async (c) => {
    const co = fake.checkouts.get(c.req.param('ref'));
    if (!co) return c.text('Unknown checkout', 404);
    if (!co.done) {
      co.done = true;
      const outcome = fakeOutcome(co.amountMinor);
      const event: WebhookEvent = { id: `evt_${newId()}`, type: outcome.ok ? 'payment.succeeded' : 'payment.failed', providerRef: co.ref, amountMinor: co.amountMinor, currency: co.currency, ...(outcome.ok ? {} : { failureCode: outcome.code }) };
      const body = JSON.stringify(event);
      // delivered like a real gateway would: a signed POST to our webhook URL
      await root.request('/api/webhooks/payments/fake', { method: 'POST', body, headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signWebhook(fake.secret, body, deps.clock()) } });
    }
    return c.redirect(co.returnUrl, 303);
  });
}

const RECEIPT = {
  en: { title: 'Payment receipt', number: 'Receipt no.', date: 'Paid on', group: 'Group', from: 'From', to: 'To', for: 'For', amount: 'Amount', fee: 'Transaction fee', total: 'Total charged', via: 'Paid through', note: 'Circle records this payment; the gateway moved the money directly to the receiver. Circle never holds funds.', purpose: { due: 'Dues', settlement: 'Settle up', gameya: 'Gam’eya share' } },
  ar: { title: 'إيصال دفع', number: 'رقم الإيصال', date: 'تاريخ الدفع', group: 'المجموعة', from: 'من', to: 'إلى', for: 'مقابل', amount: 'المبلغ', fee: 'رسوم المعاملة', total: 'الإجمالي المخصوم', via: 'وسيلة الدفع', note: 'Circle بيسجّل الدفعة بس؛ بوابة الدفع حوّلت الفلوس للمستلم مباشرة. Circle مش بيمسك فلوس.', purpose: { due: 'اشتراك', settlement: 'تسوية', gameya: 'قسط جمعية' } },
} as const;
