import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, makeGroup, ORIGIN, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let A: Client, B: Client;
let g: { id: string; code: string };
let eventId: string;

beforeAll(async () => {
  t = await setup();
  A = await t.signIn('a@example.com', 'Amal');
  B = await t.signIn('b@example.com', 'Bassem');
  g = await makeGroup(A, 'sport', 'Thursday Football');
  await join(B, g.code);
  eventId = (await A.post(`/api/groups/${g.id}/events`, { title: 'Match', startsAt: '2026-11-05T21:00:00+02:00', capacity: 2, waitlist: true })).body.id;
});
afterAll(() => t.close());

/** Minimal RFC 5545 reader: unfold, split into VEVENTs, unescape. */
function parseIcs(text: string) {
  expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  for (const line of text.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  const lines = text.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
  const events: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') (events.push(cur!), (cur = null));
    else if (cur) {
      const i = l.indexOf(':');
      cur[l.slice(0, i)] = l.slice(i + 1).replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
    }
  }
  return events;
}

describe('guest links (B9 v1.1)', () => {
  it('a non-user RSVPs through the guest page and it shows in the app', async () => {
    const link = await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId });
    expect(link.body.url).toBe(`${ORIGIN}/p/${link.body.token}`);
    // same link is reused
    expect((await B.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body.token).toBe(link.body.token);

    // server-rendered page, no session
    const pageRes = await t.app.request(`/p/${link.body.token}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('Match');
    expect(html).toContain('og:title');
    expect(html).toContain('0/2');

    // form post sets a guest cookie and redirects back
    const form = new URLSearchParams({ name: 'Mostafa', status: 'going' });
    const post = await t.app.request(`/p/${link.body.token}/rsvp`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(post.status).toBe(303);
    const cookie = post.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const after = await (await t.app.request(`/p/${link.body.token}`, { headers: { cookie } })).text();
    expect(after).toContain('1/2');
    expect(after).toContain('Going');

    const detail = await A.get(`/api/groups/${g.id}/events/${eventId}`);
    expect(detail.body.rsvps).toEqual([expect.objectContaining({ status: 'going', displayName: 'Mostafa (guest)', guest: true })]);
    const activity = await A.get(`/api/groups/${g.id}/activity`);
    expect(activity.body[0].summary).toContain('Mostafa (guest)');

    // JSON API for guests: capacity and the waitlist apply to guests too
    await B.post(`/api/groups/${g.id}/events/${eventId}/rsvp`, { status: 'going' });
    const late = await t.raw('POST', `/api/guest/${link.body.token}/events/${eventId}/rsvp`, { name: 'Late guest', status: 'going' });
    expect(await late.json()).toMatchObject({ status: 'waitlist', waitlistPos: 1 });
    // the first guest drops → the waitlisted guest is promoted
    const drop = await t.app.request(`/p/${link.body.token}/rsvp`, { method: 'POST', body: new URLSearchParams({ name: 'Mostafa', status: 'no' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } });
    expect(drop.status).toBe(303);
    const d2 = await A.get(`/api/groups/${g.id}/events/${eventId}`);
    expect(d2.body.rsvps.find((r: any) => r.displayName === 'Late guest (guest)').status).toBe('going');
  });

  it('the token only opens its own item; other ids → 404', async () => {
    const other = (await A.post(`/api/groups/${g.id}/events`, { title: 'Other', startsAt: '2026-11-06T21:00:00+02:00' })).body.id;
    const link = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body;
    expect((await t.raw('GET', `/api/guest/${link.token}/events/${eventId}`)).status).toBe(200);
    expect((await t.raw('GET', `/api/guest/${link.token}/events/${other}`)).status).toBe(404);
    expect((await t.raw('POST', `/api/guest/${link.token}/events/${other}/rsvp`, { name: 'x', status: 'going' })).status).toBe(404);
    const listId = (await A.get(`/api/groups/${g.id}/lists`)).body[0].id;
    expect((await t.raw('GET', `/api/guest/${link.token}/lists/${listId}`)).status).toBe(404);
    // a list token can't open the event
    const listLink = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'list', entityId: listId })).body;
    expect((await t.raw('GET', `/api/guest/${listLink.token}/lists/${listId}`)).status).toBe(200);
    expect((await t.raw('GET', `/api/guest/${listLink.token}/events/${eventId}`)).status).toBe(404);
    expect(await (await t.app.request(`/p/${listLink.token}`)).text()).toContain('Equipment');
    // guests never reach member routes
    expect((await t.raw('GET', `/api/groups/${g.id}/events/${eventId}`)).status).toBe(401);
    // links can't point at another group's items
    const elsewhere = await makeGroup(B, 'sport', 'Other team');
    const theirEvent = (await B.post(`/api/groups/${elsewhere.id}/events`, { title: 'Theirs', startsAt: '2026-11-06T21:00:00+02:00' })).body.id;
    expect((await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: theirEvent })).status).toBe(400);
  });

  it('a revoked token stops working', async () => {
    const link = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body;
    expect((await A.del(`/api/groups/${g.id}/guest-links/${link.id}`)).status).toBe(200);
    expect((await t.raw('GET', `/api/guest/${link.token}`)).status).toBe(404);
    expect((await t.raw('POST', `/api/guest/${link.token}/events/${eventId}/rsvp`, { name: 'x', status: 'going' })).status).toBe(404);
    expect((await t.app.request(`/p/${link.token}`)).status).toBe(404);
    // a new link is a new token
    const fresh = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body;
    expect(fresh.token).not.toBe(link.token);
  });

  it('cross-group: a member of another group cannot revoke this group’s link', async () => {
    const C = await t.signIn('c@example.com');
    const mine = await makeGroup(C, 'sport', 'C team');
    const link = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body;
    expect((await C.del(`/api/groups/${mine.id}/guest-links/${link.id}`)).status).toBe(404);
    expect((await t.raw('GET', `/api/guest/${link.token}`)).status).toBe(200);
  });

  it('Arabic guest page is right-to-left', async () => {
    const link = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body;
    const html = await (await t.app.request(`/p/${link.token}`, { headers: { 'accept-language': 'ar-EG,ar;q=0.9' } })).text();
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('رايح');
  });
});

describe('ICS feed (B9 v1.1)', () => {
  it('parses and contains only that user’s events', async () => {
    t.setNow('2026-11-02T08:00:00Z');
    const C = await t.signIn('ics-c@example.com', 'C');
    const own = await makeGroup(C, 'study', 'Masters');
    await C.post(`/api/groups/${own.id}/events`, { title: 'Exam prep, chapter 3; bring notes', startsAt: '2026-11-04T18:00:00+02:00', location: 'Library, 2nd floor' });
    const declined = (await C.post(`/api/groups/${own.id}/events`, { title: 'Declined thing', startsAt: '2026-11-05T18:00:00+02:00' })).body.id;
    await C.post(`/api/groups/${own.id}/events/${declined}/rsvp`, { status: 'no' });
    await C.post(`/api/groups/${own.id}/events`, { title: 'محاضرة طويلة جدًا عن الجبر الخطي والمعادلات التفاضلية للفصل الدراسي الأول', startsAt: '2026-11-06T18:00:00+02:00' });

    const feed = await C.get('/api/me/calendar-feed');
    expect(feed.body.url).toMatch(/\/ics\/[\w-]+\.ics$/);
    const res = await t.app.request(new URL(feed.body.url).pathname);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const events = parseIcs(await res.text());
    const titles = events.map((e) => e.SUMMARY);
    expect(titles).toContain('Exam prep, chapter 3; bring notes');
    expect(titles).toContain('محاضرة طويلة جدًا عن الجبر الخطي والمعادلات التفاضلية للفصل الدراسي الأول');
    expect(titles).not.toContain('Declined thing');
    // nothing from groups C is not in (A's football group has a "Match")
    expect(titles).not.toContain('Match');
    expect(titles).not.toContain('Weekly match');
    const exam = events.find((e) => e.SUMMARY.startsWith('Exam'))!;
    expect(exam).toMatchObject({ DTSTART: '20261104T160000Z', LOCATION: 'Library, 2nd floor', DESCRIPTION: 'Masters' });

    // rotating revokes the old URL
    const rotated = await C.post('/api/me/calendar-feed/rotate');
    expect((await t.app.request(new URL(feed.body.url).pathname)).status).toBe(404);
    expect((await t.app.request(new URL(rotated.body.url).pathname)).status).toBe(200);
  });
});

describe('universal links, phone OTP, social sign-in', () => {
  it('serves the association files for the placeholder domain', async () => {
    const aasa = await (await t.app.request('/.well-known/apple-app-site-association')).json();
    expect(aasa.applinks.details[0].appIDs[0]).toMatch(/\.app\.circle\.mobile$/);
    expect(aasa.applinks.details[0].components).toEqual([{ '/': '/join/*' }, { '/': '/p/*' }]);
    const al = await (await t.app.request('/.well-known/assetlinks.json')).json();
    expect(al[0].target.package_name).toBe('app.circle.mobile');
  });

  it('phone OTP signs up through the fake SMS driver', async () => {
    const phone = '+201001234567';
    const send = await t.raw('POST', '/api/auth/phone-number/send-otp', { phoneNumber: phone });
    expect(send.status).toBe(200);
    const code = t.deps.sms.lastCode!(phone)!;
    expect(code).toMatch(/^\d{6}$/);
    expect((await t.raw('POST', '/api/auth/phone-number/verify', { phoneNumber: phone, code: '000000' === code ? '111111' : '000000' })).status).not.toBe(200);
    const ok = await t.raw('POST', '/api/auth/phone-number/verify', { phoneNumber: phone, code });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const me = await t.raw('GET', '/api/me', undefined, cookie);
    expect(await me.json()).toMatchObject({ phoneNumber: phone, phoneNumberVerified: true });
    expect((await t.raw('POST', '/api/auth/phone-number/send-otp', { phoneNumber: '12345' })).status).toBe(400);
  });

  it('social buttons are hidden without client ids and wired when present', async () => {
    expect(await (await t.app.request('/api/config')).json()).toMatchObject({ google: false, apple: false });
    const withGoogle = await setup({ env: { nodeEnv: 'test', publicUrl: ORIGIN, google: { clientId: 'fake-id.apps.googleusercontent.com', clientSecret: 'fake' } } });
    expect(await (await withGoogle.app.request('/api/config')).json()).toMatchObject({ google: true });
    const res = await withGoogle.raw('POST', '/api/auth/sign-in/social', { provider: 'google', callbackURL: '/' });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain('accounts.google.com');
    await withGoogle.close();
  });
});

describe('opening a shared item in the app', () => {
  it('members get the in-app location; non-members get 404', async () => {
    const link = (await A.post(`/api/groups/${g.id}/guest-links`, { entity: 'event', entityId: eventId })).body;
    expect((await B.get(`/api/guest/${link.token}/open`)).body).toEqual({ groupId: g.id, entity: 'event', entityId: eventId });
    const stranger = await t.signIn('stranger@example.com');
    expect((await stranger.get(`/api/guest/${link.token}/open`)).status).toBe(404);
  });
});
