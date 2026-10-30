import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { schemas } from '@circle/shared';
import { eventRsvps, events, groupMembers, groups, guestLinks, invitees, listItems, lists } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity } from '../effects';
import { badRequest, forbidden, notFound } from '../errors';
import { actorCan, emit, type Router } from '../http';
import { newId, newToken } from '../ids';
import { setRsvp } from '../services/events';
import { inviteeRsvp } from './money2';

const GUEST_ENTITIES = ['event', 'list'] as const;
// 'invitee' links (v2.0 guest list) are created by the guest list itself, not through POST /guest-links
type GuestEntity = (typeof GUEST_ENTITIES)[number];

/**
 * Resolves a guest token to its group and the one item it may touch. This is the guest form of the membership guard:
 * a revoked or unknown token → 404, and any other item id → 404 (B9 v1.1).
 */
export async function resolveGuest(deps: Deps, token: string, entity?: GuestEntity, entityId?: string) {
  const [row] = await deps.db
    .select({ link: guestLinks, group: groups })
    .from(guestLinks)
    .innerJoin(groups, eq(groups.id, guestLinks.groupId))
    .where(and(eq(guestLinks.token, token), isNull(guestLinks.revokedAt)))
    .limit(1);
  if (!row) throw notFound();
  if (entity && (row.link.entity !== entity || (entityId !== undefined && row.link.entityId !== entityId))) throw notFound();
  return row;
}

async function guestEvent(deps: Deps, groupId: string, eventId: string, guestKey: string | null) {
  const [ev] = await deps.db.select().from(events).where(and(eq(events.id, eventId), eq(events.groupId, groupId), isNull(events.cancelledAt)));
  if (!ev || ev.rrule) throw notFound();
  const [{ going }] = await deps.db.select({ going: count() }).from(eventRsvps).where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.status, 'going')));
  const [mine] = guestKey ? await deps.db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, ev.id), eq(eventRsvps.userId, guestKey))) : [];
  return {
    id: ev.id,
    title: ev.title,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    tz: ev.tz,
    location: ev.location,
    capacity: ev.capacity,
    waitlist: ev.waitlist,
    going,
    myStatus: mine?.status ?? null,
    myName: mine?.guestName ?? null,
    waitlistPos: mine?.waitlistPos ?? null,
  };
}

async function guestList(deps: Deps, groupId: string, listId: string) {
  const [l] = await deps.db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.groupId, groupId), isNull(lists.archivedAt)));
  if (!l) throw notFound();
  const items = await deps.db.select({ title: listItems.title, qty: listItems.qty, checked: listItems.checked }).from(listItems).where(eq(listItems.listId, l.id)).orderBy(asc(listItems.checked), asc(listItems.position));
  return { id: l.id, title: l.title, items };
}

export async function guestRsvp(deps: Deps, a: { token: string; eventId: string; guestId: string; name: string; status: 'going' | 'maybe' | 'no' }) {
  const { group } = await resolveGuest(deps, a.token, 'event', a.eventId);
  const userId = `guest:${a.guestId}`;
  const result = await deps.db.transaction(async (tx) => {
    const res = await setRsvp(deps, tx, { groupId: group.id, eventId: a.eventId, userId, status: a.status });
    await tx.update(eventRsvps).set({ guestName: a.name }).where(and(eq(eventRsvps.eventId, a.eventId), eq(eventRsvps.userId, userId)));
    await logActivity(tx, { groupId: group.id, actorId: null, verb: 'rsvp', entity: 'event', entityId: a.eventId, summary: `${a.name} (guest): ${res.status}` });
    return res;
  });
  deps.bus.publish({ type: 'invalidate', groupId: group.id, entity: 'events', id: a.eventId });
  return { ...result, groupId: group.id };
}

export function registerGuestRoutes(r: Router, deps: Deps, root: Hono) {
  const { db } = deps;
  const linkUrl = (token: string) => `${deps.env.publicUrl}/p/${token}`;

  // ── member side ─────────────────────────────────────────────────────────────
  r.post('/groups/:groupId/guest-links', { perm: 'items.create', tags: ['guest'], summary: 'Create (or reuse) a guest link for one item', body: z.object({ entity: z.enum(GUEST_ENTITIES), entityId: z.string().min(1).max(64) }) }, async (c, { body }) => {
    const group = c.get('group');
    if (body.entity === 'event') {
      const [ev] = await db.select().from(events).where(and(eq(events.id, body.entityId), eq(events.groupId, group.id)));
      if (!ev || ev.rrule) throw badRequest('bad_item');
    } else {
      const [l] = await db.select().from(lists).where(and(eq(lists.id, body.entityId), eq(lists.groupId, group.id)));
      if (!l) throw badRequest('bad_item');
    }
    const [existing] = await db
      .select()
      .from(guestLinks)
      .where(and(eq(guestLinks.groupId, group.id), eq(guestLinks.entity, body.entity), eq(guestLinks.entityId, body.entityId), isNull(guestLinks.revokedAt)));
    const link = existing ?? (await db.insert(guestLinks).values({ id: newId(), groupId: group.id, token: newToken(18), entity: body.entity, entityId: body.entityId, createdBy: c.get('user').id }).returning())[0];
    return { ...link, url: linkUrl(link.token) };
  });

  r.get('/groups/:groupId/guest-links', { perm: 'items.create', tags: ['guest'], summary: 'Active guest links' }, async (c) => {
    const rows = await db.select().from(guestLinks).where(and(eq(guestLinks.groupId, c.get('group').id), isNull(guestLinks.revokedAt)));
    return rows.map((l) => ({ ...l, url: linkUrl(l.token) }));
  });

  r.delete('/groups/:groupId/guest-links/:linkId', { perm: 'items.create', tags: ['guest'], summary: 'Revoke a guest link' }, async (c) => {
    const group = c.get('group');
    const [l] = await db.select().from(guestLinks).where(and(eq(guestLinks.id, c.req.param('linkId')!), eq(guestLinks.groupId, group.id)));
    if (!l) throw notFound();
    if (l.createdBy !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    await db.update(guestLinks).set({ revokedAt: deps.clock() }).where(eq(guestLinks.id, l.id));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'guest-links' });
    return { ok: true };
  });

  // ── guest side: the token is the credential ─────────────────────────────────
  r.get('/guest/:token', { auth: 'public', tags: ['guest'], summary: 'What a guest link points at' }, async (c) => {
    const { link, group } = await resolveGuest(deps, c.req.param('token')!);
    return { group: { name: group.name, emoji: group.emoji, color: group.color }, entity: link.entity, entityId: link.entityId };
  });

  r.get('/guest/:token/open', { tags: ['guest'], summary: 'For a signed-in member: where this item lives in the app' }, async (c) => {
    const { link, group } = await resolveGuest(deps, c.req.param('token')!);
    const [m] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, c.get('user').id)));
    if (!m) throw notFound();
    return { groupId: group.id, entity: link.entity, entityId: link.entityId };
  });

  r.get('/guest/:token/events/:eventId', { auth: 'public', tags: ['guest'], summary: 'Event as a guest sees it', query: z.object({ guestId: z.string().max(64).optional() }) }, async (c, { query }) => {
    const { group } = await resolveGuest(deps, c.req.param('token')!, 'event', c.req.param('eventId'));
    return guestEvent(deps, group.id, c.req.param('eventId')!, query.guestId ? `guest:${query.guestId}` : null);
  });

  r.post('/guest/:token/events/:eventId/rsvp', { auth: 'public', tags: ['guest'], summary: 'RSVP without the app', body: z.object({ name: z.string().trim().min(1).max(60), status: z.enum(['going', 'maybe', 'no']), guestId: z.string().uuid().optional() }) }, async (c, { body }) => {
    const guestId = body.guestId ?? newId();
    const res = await guestRsvp(deps, { token: c.req.param('token')!, eventId: c.req.param('eventId')!, guestId, name: body.name, status: body.status });
    return { status: res.status, waitlistPos: res.waitlistPos, guestId };
  });

  r.get('/guest/:token/lists/:listId', { auth: 'public', tags: ['guest'], summary: 'List as a guest sees it' }, async (c) => {
    const { group } = await resolveGuest(deps, c.req.param('token')!, 'list', c.req.param('listId'));
    return guestList(deps, group.id, c.req.param('listId')!);
  });

  // ── server-rendered guest pages (no app needed) ─────────────────────────────
  root.get('/p/:token', async (c) => {
    const token = c.req.param('token');
    let resolved;
    try {
      resolved = await resolveGuest(deps, token);
    } catch {
      return c.html(page({ lang: pickLang(c.req.header('accept-language'), c.req.query('lang')), title: 'Circle', body: `<p class="muted">${t(pickLang(c.req.header('accept-language'), c.req.query('lang')), 'gone')}</p>` }), 404);
    }
    const { link, group } = resolved;
    const lang = pickLang(c.req.header('accept-language'), c.req.query('lang'));
    const guestId = getCookie(c, 'circle_guest');
    const visits = Number(getCookie(c, 'circle_visits') ?? '0') + 1;
    setCookie(c, 'circle_visits', String(visits), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' });
    const install = visits > 2 ? `<a class="install" href="circleapp://p/${esc(token)}">${t(lang, 'install')}</a>` : '';
    const head = `<div class="group" style="border-color:${esc(group.color)}">${esc(group.emoji)} ${esc(group.name)}</div>`;
    if (link.entity === 'invitee') {
      const [inv] = await db.select().from(invitees).where(and(eq(invitees.id, link.entityId), eq(invitees.groupId, group.id)));
      if (!inv) return c.html(page({ lang, title: 'Circle', body: `<p class="muted">${t(lang, 'gone')}</p>` }), 404);
      const plus = inv.maxPlusOnes
        ? `<label>${t(lang, 'plusOnes')} (≤ ${inv.maxPlusOnes})<input name="plusOnes" type="number" min="0" max="${inv.maxPlusOnes}" value="${inv.plusOnes}" data-testid="guest-plus"></label>`
        : '';
      const status = inv.status !== 'invited' ? `<p class="status">${t(lang, 'you')}: <b>${t(lang, inv.status)}${inv.plusOnes ? ` +${inv.plusOnes}` : ''}</b></p>` : '';
      const body = `${head}<h1>${esc(group.name)}</h1><p class="muted">${t(lang, 'dear')} ${esc(inv.name)}</p>${status}
<form method="post" action="/p/${esc(token)}/invitee?lang=${lang}">${plus}
<label>${t(lang, 'dietary')}<input name="dietary" maxlength="200" value="${esc(inv.dietary ?? '')}"></label>
<div class="row"><button name="status" value="going" data-testid="guest-going">${t(lang, 'going')}</button><button name="status" value="maybe" class="sec">${t(lang, 'maybe')}</button><button name="status" value="no" class="sec">${t(lang, 'no')}</button></div></form>${install}`;
      return c.html(page({ lang, title: `${group.emoji} ${group.name}`, description: t(lang, 'tap'), body }));
    }
    if (link.entity === 'event') {
      const ev = await guestEvent(deps, group.id, link.entityId, guestId ? `guest:${guestId}` : null);
      const when = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: ev.tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(ev.startsAt);
      const spots = ev.capacity ? `${ev.going}/${ev.capacity} ${t(lang, 'in')}` : `${ev.going} ${t(lang, 'going')}`;
      const status = ev.myStatus ? `<p class="status">${t(lang, 'you')}: <b>${t(lang, ev.myStatus)}${ev.waitlistPos ? ` #${ev.waitlistPos}` : ''}</b></p>` : '';
      const body = `${head}<h1>${esc(ev.title)}</h1><p class="muted">${esc(when)}${ev.location ? ` · 📍 ${esc(ev.location)}` : ''}</p>
<p class="spots" data-testid="guest-spots">${spots}</p>${status}
<form method="post" action="/p/${esc(token)}/rsvp?lang=${lang}">
<label>${t(lang, 'name')}<input name="name" required maxlength="60" value="${esc(ev.myName ?? '')}" data-testid="guest-name"></label>
<div class="row"><button name="status" value="going" data-testid="guest-going">${t(lang, 'going')}</button><button name="status" value="maybe" class="sec">${t(lang, 'maybe')}</button><button name="status" value="no" class="sec" data-testid="guest-no">${t(lang, 'no')}</button></div>
</form>${install}`;
      return c.html(page({ lang, title: `${group.emoji} ${ev.title}: ${spots}`, description: `${when} · ${t(lang, 'tap')}`, body }));
    }
    const l = await guestList(deps, group.id, link.entityId);
    const items = l.items.map((i) => `<li class="${i.checked ? 'done' : ''}">${i.checked ? '✓ ' : ''}${esc(i.title)}${i.qty ? ` × ${esc(i.qty)}` : ''}</li>`).join('');
    return c.html(page({ lang, title: `${group.emoji} ${l.title}`, description: `${l.items.filter((i) => !i.checked).length} ${t(lang, 'left')}`, body: `${head}<h1>${esc(l.title)}</h1><ul data-testid="guest-list">${items}</ul>${install}` }));
  });

  root.post('/p/:token/invitee', async (c) => {
    const token = c.req.param('token');
    const form = await c.req.parseBody();
    const parsed = schemas.guestRsvp.safeParse({ status: String(form.status ?? ''), plusOnes: Number(form.plusOnes ?? 0) || 0, dietary: form.dietary ? String(form.dietary) : undefined });
    if (parsed.success) await inviteeRsvp(deps, token, parsed.data);
    return c.redirect(`/p/${token}?lang=${c.req.query('lang') ?? ''}`, 303);
  });

  r.post('/guest/:token/invitee', { auth: 'public', tags: ['guest'], summary: 'Invitee RSVP with plus-ones', body: schemas.guestRsvp }, async (c, { body }) => {
    const row = await inviteeRsvp(deps, c.req.param('token')!, body);
    return { status: row.status, plusOnes: row.plusOnes };
  });

  root.post('/p/:token/rsvp', async (c) => {
    const token = c.req.param('token');
    const form = await c.req.parseBody();
    const name = String(form.name ?? '').trim().slice(0, 60);
    const status = String(form.status ?? '');
    if (!name || !['going', 'maybe', 'no'].includes(status)) return c.redirect(`/p/${token}`, 303);
    const { link } = await resolveGuest(deps, token, 'event');
    let guestId = getCookie(c, 'circle_guest');
    if (!guestId || !/^[0-9a-f-]{36}$/.test(guestId)) guestId = newId();
    setCookie(c, 'circle_guest', guestId, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' });
    await guestRsvp(deps, { token, eventId: link.entityId, guestId, name, status: status as 'going' });
    return c.redirect(`/p/${token}?lang=${c.req.query('lang') ?? ''}`, 303);
  });
}

const STR = {
  en: { plusOnes: 'Guests with you', dietary: 'Dietary needs', dear: 'Dear', going: 'Going', maybe: 'Maybe', no: "Can't", in: 'in', name: 'Your name', you: 'You', tap: 'Tap to join', left: 'left', install: 'Get the Circle app', gone: 'This link has expired or was turned off.', waitlist: 'Waitlist' },
  ar: { plusOnes: 'مرافقين', dietary: 'احتياجات غذائية', dear: 'عزيزنا', going: 'رايح', maybe: 'يمكن', no: 'مش هقدر', in: 'جايين', name: 'اسمك', you: 'أنت', tap: 'اضغط للانضمام', left: 'متبقي', install: 'نزّل تطبيق Circle', gone: 'هذا الرابط انتهى أو تم إيقافه.', waitlist: 'قائمة الانتظار' },
} as const;

function t(lang: 'en' | 'ar', key: string): string {
  return (STR[lang] as Record<string, string>)[key] ?? (STR.en as Record<string, string>)[key] ?? key;
}

export function pickLang(acceptLanguage?: string, override?: string): 'en' | 'ar' {
  if (override === 'ar' || override === 'en') return override;
  return acceptLanguage?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Minimal page with Open Graph tags so a WhatsApp share renders a card. */
export function page(p: { lang: 'en' | 'ar'; title: string; description?: string; body: string }) {
  return `<!doctype html><html lang="${p.lang}" dir="${p.lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(p.title)}</title>
<meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description ?? '')}"><meta property="og:site_name" content="Circle">
<style>body{font-family:system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",sans-serif;background:#F5F4F0;color:#1C1C1E;margin:0;padding:24px;max-width:520px;margin-inline:auto}
h1{font-size:24px;margin:12px 0 4px}.muted{color:#66666D}.group{border-inline-start:4px solid;padding-inline-start:8px;color:#66666D;font-weight:600}
.spots{font-size:20px;font-weight:700}label{display:block;margin:16px 0 8px;font-weight:600;color:#66666D}input{display:block;width:100%;box-sizing:border-box;min-height:48px;border:1px solid #E4E2DC;border-radius:12px;padding:0 12px;font-size:16px;margin-top:6px}
.row{display:flex;gap:8px;flex-wrap:wrap}button{min-height:48px;padding:0 18px;border:0;border-radius:12px;background:#2F6F62;color:#fff;font-size:16px;font-weight:600}button.sec{background:#ECEAE4;color:#1C1C1E}
ul{background:#fff;border-radius:14px;padding:12px 28px}li{padding:6px 0}li.done{color:#9A9AA1;text-decoration:line-through}.install{display:block;margin-top:24px;text-align:center;color:#2F6F62;font-weight:700}</style>
</head><body>${p.body}<p class="muted" style="margin-top:32px;font-size:12px">Circle</p></body></html>`;
}
