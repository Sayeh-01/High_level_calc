import { schemas, validateAnswers, type FormField, type Signature } from '@circle/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { formResponses, forms, groupMembers } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { esc } from './guest';

// Forms & sign-offs (A7, B9 v2.8): custom fields checked on the server, a drawn signature stored with the typed name and the
// time, shown in the app and on a printable sheet. Only the people a form is for (and its managers) can see it.

type Form = typeof forms.$inferSelect;

/** Inline SVG of a stored signature. The path grammar is validated on the way in (digits, spaces, M and L only). */
export function signatureSvg(s: Signature, height = 60) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width} ${s.height}" height="${height}" preserveAspectRatio="xMinYMid meet"><path d="${esc(s.path)}" fill="none" stroke="#1C1C1E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function registerFormRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';
  const mod = { module: 'forms', tags: ['forms'] };

  const isManager = (c: Ctx, f: Form) => f.createdBy === c.get('user').id || actorCan(c, 'approve');
  const isFor = (c: Ctx, f: Form) => f.memberIds.length === 0 || f.memberIds.includes(c.get('user').id);

  async function load(c: Ctx) {
    const [f] = await db.select().from(forms).where(and(eq(forms.id, c.req.param('formId')!), eq(forms.groupId, c.get('group').id)));
    // a form that isn't for you doesn't exist for you (like a vault folder)
    if (!f || (!isFor(c, f) && !isManager(c, f))) throw notFound();
    return f;
  }
  async function audience(f: Form) {
    const members = (await db.select({ u: groupMembers.userId, role: groupMembers.role, name: groupMembers.displayName }).from(groupMembers).where(eq(groupMembers.groupId, f.groupId))).filter((m) => m.role !== 'guest');
    return f.memberIds.length ? members.filter((m) => f.memberIds.includes(m.u)) : members;
  }
  const isOpen = (f: Form) => !f.closedAt && (!f.closesAt || f.closesAt > deps.clock());

  r.get(`${base}/forms`, { ...mod, perm: 'items.read', summary: 'Forms for me (all of them for managers)' }, async (c) => {
    const group = c.get('group');
    const me = c.get('user').id;
    const rows = (await db.select().from(forms).where(eq(forms.groupId, group.id)).orderBy(desc(forms.createdAt))).filter((f) => isFor(c, f) || isManager(c, f));
    const mine = await db.select().from(formResponses).where(and(eq(formResponses.groupId, group.id), eq(formResponses.userId, me)));
    const all = await db.select({ formId: formResponses.formId }).from(formResponses).where(eq(formResponses.groupId, group.id));
    return Promise.all(
      rows.map(async (f) => ({
        ...f,
        open: isOpen(f),
        forMe: isFor(c, f),
        responded: !!mine.find((x) => x.formId === f.id),
        ...(isManager(c, f) ? { responses: all.filter((x) => x.formId === f.id).length, expected: (await audience(f)).length } : {}),
      })),
    );
  });

  r.post(`${base}/forms`, { ...mod, perm: 'approve', summary: 'Create a form or permission slip', body: schemas.formCreate }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    if (new Set(body.fields.map((f) => f.id)).size !== body.fields.length) throw badRequest('duplicate_field');
    if (body.fields.some((f) => (f.type === 'choice') !== !!f.options)) throw badRequest('choice_needs_options');
    if (!body.fields.length && !body.requireSignature) throw badRequest('empty_form');
    const members = (await db.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).map((m) => m.u);
    if (body.memberIds.some((u) => !members.includes(u))) throw badRequest('not_a_member');
    const row = await db.transaction(async (tx) => {
      const [f] = await tx
        .insert(forms)
        .values({ id: newId(), groupId: group.id, title: body.title, description: body.description, fields: body.fields as FormField[], requireSignature: body.requireSignature, memberIds: body.memberIds, closesAt: body.closesAt ? new Date(body.closesAt) : null, createdBy: user.id, createdAt: deps.clock() })
        .returning();
      const targets = body.memberIds.length ? body.memberIds : members;
      await notify(tx, { userIds: targets, groupId: group.id, kind: 'form', title: `🖊️ ${f.title}`, body: f.requireSignature ? 'Please read and sign' : 'Please fill this in', data: { formId: f.id, href: `/g/${group.id}/form/${f.id}` }, now: deps.clock(), exclude: user.id });
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'created', entity: 'form', entityId: f.id, summary: f.title });
      return f;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'forms' });
    return row;
  });

  r.get(`${base}/forms/:formId`, { ...mod, perm: 'items.read', summary: 'The form, my answers, and (managers) every response with its signature' }, async (c) => {
    const f = await load(c);
    const me = c.get('user').id;
    const [mine] = await db.select().from(formResponses).where(and(eq(formResponses.formId, f.id), eq(formResponses.userId, me)));
    const base = { form: f, open: isOpen(f), forMe: isFor(c, f), mine: mine ?? null, manager: isManager(c, f) };
    if (!isManager(c, f)) return base;
    const responses = await db.select().from(formResponses).where(eq(formResponses.formId, f.id)).orderBy(desc(formResponses.submittedAt));
    const people = await audience(f);
    const tallies: Record<string, Record<string, number>> = {};
    for (const field of f.fields.filter((x) => x.type === 'choice' || x.type === 'yes_no')) {
      tallies[field.id] = {};
      for (const res of responses) {
        const v = res.answers[field.id];
        if (v !== undefined) tallies[field.id][String(v)] = (tallies[field.id][String(v)] ?? 0) + 1;
      }
    }
    return { ...base, responses, expected: people.length, missing: people.filter((p) => !responses.find((x) => x.userId === p.u)).map((p) => p.u), tallies };
  });

  r.post(`${base}/forms/:formId/respond`, { ...mod, perm: 'items.read', summary: 'Answer (and sign); answering again replaces my answers', body: schemas.formRespond }, async (c, { body }) => {
    const f = await load(c);
    if (!isFor(c, f)) throw forbidden('not_for_you');
    if (!isOpen(f)) throw conflict('form_closed');
    const checked = validateAnswers(f.fields, body.answers);
    if (!checked.ok) throw badRequest('invalid_answers', undefined, checked.errors);
    if (f.requireSignature && !body.signature) throw badRequest('signature_required');
    const now = deps.clock();
    const values = { answers: checked.answers, signature: body.signature ?? null, signedAt: body.signature ? now : null, submittedAt: now };
    const [row] = await db
      .insert(formResponses)
      .values({ id: newId(), formId: f.id, groupId: f.groupId, userId: c.get('user').id, ...values })
      .onConflictDoUpdate({ target: [formResponses.formId, formResponses.userId], set: values })
      .returning();
    if (f.createdBy !== c.get('user').id)
      await notify(db, { userIds: [f.createdBy], groupId: f.groupId, kind: 'form_response', title: `🖊️ ${f.title}`, body: `${c.get('member').displayName} ${body.signature ? 'signed' : 'answered'}`, data: { formId: f.id, href: `/g/${f.groupId}/form/${f.id}` }, push: false, now });
    emit(c, { type: 'invalidate', groupId: f.groupId, entity: 'forms' });
    return row;
  });

  r.post(`${base}/forms/:formId/close`, { ...mod, perm: 'items.read', summary: 'Stop accepting answers' }, async (c) => {
    const f = await load(c);
    if (!isManager(c, f)) throw forbidden();
    await db.update(forms).set({ closedAt: deps.clock() }).where(eq(forms.id, f.id));
    emit(c, { type: 'invalidate', groupId: f.groupId, entity: 'forms' });
    return { ok: true };
  });

  r.delete(`${base}/forms/:formId`, { ...mod, perm: 'items.read', summary: 'Delete a form and its answers' }, async (c) => {
    const f = await load(c);
    if (!isManager(c, f)) throw forbidden();
    await db.delete(forms).where(eq(forms.id, f.id));
    emit(c, { type: 'invalidate', groupId: f.groupId, entity: 'forms' });
    return { ok: true };
  });

  /** Printable sheet with every answer and signature (expo-print on the phone, the print dialog on web). */
  r.get(`${base}/forms/:formId/sheet`, { ...mod, perm: 'items.read', summary: 'Printable responses with signatures (HTML)', query: z.object({ lang: z.enum(['en', 'ar']).default('en') }) }, async (c, { query }) => {
    const group = c.get('group');
    const f = await load(c);
    if (!isManager(c, f)) throw forbidden();
    const responses = await db.select().from(formResponses).where(eq(formResponses.formId, f.id));
    const people = await audience(f);
    const name = (u: string) => people.find((p) => p.u === u)?.name ?? '—';
    const ar = query.lang === 'ar';
    const when = new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: group.timezone });
    const show = (v: unknown) => (v === true ? (ar ? 'نعم' : 'Yes') : v === false ? (ar ? 'لا' : 'No') : v === undefined ? '' : String(v));
    const head = `<tr><th>${ar ? 'العضو' : 'Member'}</th>${f.fields.map((x) => `<th>${esc(x.label)}</th>`).join('')}${f.requireSignature ? `<th>${ar ? 'التوقيع' : 'Signature'}</th>` : ''}</tr>`;
    const rows = responses
      .map((res) => `<tr><td>${esc(name(res.userId))}<br><small>${esc(when.format(res.submittedAt))}</small></td>${f.fields.map((x) => `<td>${esc(show(res.answers[x.id]))}</td>`).join('')}${f.requireSignature ? `<td>${res.signature ? `${signatureSvg(res.signature)}<br><small>${esc(res.signature.name)}</small>` : ''}</td>` : ''}</tr>`)
      .join('');
    const html = `<!doctype html><html lang="${query.lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(f.title)}</title>
<style>body{font-family:-apple-system,"Segoe UI","Noto Naskh Arabic",sans-serif;color:#1C1C1E;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px;text-align:start;vertical-align:top}small{color:#777}</style></head>
<body><h1>${esc(group.emoji)} ${esc(f.title)}</h1><p>${esc(f.description)}</p><p>${responses.length} / ${people.length}</p><table>${head}${rows}</table></body></html>`;
    return { html, title: f.title };
  });
}
