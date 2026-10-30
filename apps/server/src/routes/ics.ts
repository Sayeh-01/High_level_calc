import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { Hono } from 'hono';
import { calendarTokens, eventRsvps, events, groupMembers, groups } from '../db/schema';
import type { Deps } from '../deps';
import type { Router } from '../http';
import { newId, newToken } from '../ids';
import { ensureMaterialized } from '../services/events';

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 folding: lines longer than 75 octets continue on the next line after a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(name: string, evs: { id: string; title: string; startsAt: Date; endsAt: Date | null; location: string | null; groupName: string }[], now: Date) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Circle//Circle Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`];
  for (const e of evs) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@circle`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(e.startsAt)}`,
      `DTEND:${icsDate(e.endsAt ?? new Date(e.startsAt.getTime() + 60 * 60_000))}`,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(e.groupName)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function registerIcsRoutes(r: Router, deps: Deps, root: Hono) {
  const { db } = deps;
  const urlFor = (token: string) => `${deps.env.publicUrl}/ics/${token}.ics`;

  r.get('/me/calendar-feed', { tags: ['me'], summary: 'My private ICS feed URL' }, async (c) => {
    const userId = c.get('user').id;
    const [existing] = await db.select().from(calendarTokens).where(and(eq(calendarTokens.userId, userId), isNull(calendarTokens.revokedAt)));
    const token = existing?.token ?? (await db.insert(calendarTokens).values({ id: newId(), userId, token: newToken(24) }).returning())[0].token;
    return { url: urlFor(token), webcal: urlFor(token).replace(/^https?:/, 'webcal:') };
  });

  r.post('/me/calendar-feed/rotate', { tags: ['me'], summary: 'Revoke my feed URL and make a new one' }, async (c) => {
    const userId = c.get('user').id;
    await db.update(calendarTokens).set({ revokedAt: deps.clock() }).where(and(eq(calendarTokens.userId, userId), isNull(calendarTokens.revokedAt)));
    const [row] = await db.insert(calendarTokens).values({ id: newId(), userId, token: newToken(24) }).returning();
    return { url: urlFor(row.token) };
  });

  root.get('/ics/:file', async (c) => {
    const token = c.req.param('file').replace(/\.ics$/, '');
    const [tok] = await db.select().from(calendarTokens).where(and(eq(calendarTokens.token, token), isNull(calendarTokens.revokedAt)));
    if (!tok) return c.text('Not found', 404);
    const now = deps.clock();
    const mine = await db
      .select({ id: groups.id, name: groups.name, modules: groups.modules })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, tok.userId));
    const ids = mine.filter((g) => g.modules.includes('events')).map((g) => g.id);
    await ensureMaterialized(db, ids, now);
    const rows = ids.length
      ? await db
          .select()
          .from(events)
          .where(and(inArray(events.groupId, ids), isNull(events.rrule), isNull(events.cancelledAt), gte(events.startsAt, new Date(now.getTime() - 30 * 86_400_000)), lt(events.startsAt, new Date(now.getTime() + 120 * 86_400_000))))
      : [];
    const declined = new Set(
      (await db.select({ e: eventRsvps.eventId }).from(eventRsvps).where(and(eq(eventRsvps.userId, tok.userId), eq(eventRsvps.status, 'no')))).map((x) => x.e),
    );
    const body = buildIcs(
      'Circle',
      rows.filter((e) => !declined.has(e.id)).map((e) => ({ ...e, groupName: mine.find((g) => g.id === e.groupId)?.name ?? '' })),
      now,
    );
    return c.body(body, 200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300' });
  });
}

/** Universal-link association files served from the placeholder domain until a real one exists. */
export function registerWellKnown(deps: Deps, root: Hono) {
  root.get('/.well-known/apple-app-site-association', (c) =>
    c.json({
      applinks: { details: [{ appIDs: [`${deps.env.iosTeamId}.${deps.env.iosBundleId}`], components: [{ '/': '/join/*' }, { '/': '/p/*' }] }] },
      webcredentials: { apps: [`${deps.env.iosTeamId}.${deps.env.iosBundleId}`] },
    }),
  );
  root.get('/.well-known/assetlinks.json', (c) =>
    c.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: deps.env.androidPackage, sha256_cert_fingerprints: deps.env.androidSha256 },
      },
    ]),
  );
}
