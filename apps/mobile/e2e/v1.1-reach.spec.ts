import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

// B9 v1.1: a guest link page lets a non-user RSVP, and the RSVP shows in the app.
test('guest RSVP from the web page shows in the app; Arabic screens', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-sport').click();
  await A.page.getByTestId('group-name').fill('Thursday Football');
  await A.page.getByTestId('create-group').click();
  await A.page.getByTestId('invite-done').click();
  const groupId = new URL(A.page.url()).pathname.split('/')[2];
  await A.page.getByTestId('tab-events').click();
  await A.page.getByTestId('new-event').click();
  await A.page.getByTestId('event-title').fill('Friday 5-a-side');
  await A.page.getByTestId('event-when-day-1').click();
  await A.page.getByTestId('event-save').click();
  await expect(A.page.getByTestId('event-detail')).toBeVisible();
  const eventPath = new URL(A.page.url()).pathname;
  const eventId = eventPath.split('/').pop()!;
  await A.page.getByTestId('event-guest-link').click();
  await expect(A.page.getByTestId('event-guest-link')).toContainText('copied');
  const link = await (await A.page.request.post(`/api/groups/${groupId}/guest-links`, { data: { entity: 'event', entityId: eventId } })).json();

  // a guest with no account and no app
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestCtx.newPage();
  await guest.goto(new URL(link.url).pathname);
  await expect(guest.getByTestId('guest-spots')).toContainText('0/12');
  await guest.getByTestId('guest-name').fill('Mostafa');
  await guest.getByTestId('guest-going').click();
  await expect(guest.getByTestId('guest-spots')).toContainText('1/12');

  // the RSVP shows in the app (realtime invalidation, no reload)
  await expect(A.page.getByTestId('event-going-list')).toContainText('Mostafa (guest)');
  await expect(A.page.getByTestId('event-spots')).toContainText('1/12');

  // Arabic: guest page, Me (calendar feed), group settings (guest links), phone sign-in
  const arGuestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
  const arGuest = await arGuestCtx.newPage();
  await arGuest.goto(new URL(link.url).pathname);
  await expect(arGuest.locator('html')).toHaveAttribute('dir', 'rtl');
  await shoot(arGuest, 'v1.1', 'ar-guest-event');

  await setLanguage(A.page, 'ar');
  await expect(A.page.getByTestId('calendar-feed')).toContainText('/ics/');
  await shoot(A.page, 'v1.1', 'ar-me-calendar-feed');
  await A.page.goto(`/g/${groupId}/settings`);
  await expect(A.page.getByTestId('guest-links')).toBeVisible();
  await shoot(A.page, 'v1.1', 'ar-settings-guest-links');

  const anon = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await anon.goto('/');
  await anon.getByTestId('lang-ar').click();
  await anon.getByTestId('toggle-phone').click();
  await expect(anon.getByTestId('phone-input')).toBeVisible();
  await shoot(anon, 'v1.1', 'ar-sign-in-phone');
  expect(A.errors).toEqual([]);
});

test('phone OTP sign-in on web (fake SMS driver)', async ({ page }) => {
  const phone = `+2010${String(Date.now()).slice(-8)}`;
  await page.goto('/');
  await page.getByTestId('toggle-phone').click();
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('send-code').click();
  const { code } = await (await page.request.get(`/api/test/sms?phone=${encodeURIComponent(phone)}`)).json();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('verify-code').click();
  await page.getByTestId('name-input').fill('Phone user');
  await page.getByTestId('name-continue').click();
  await expect(page.getByTestId('today-screen')).toBeVisible();
});

test('universal-link files are served', async ({ request }) => {
  const aasa = await (await request.get('/.well-known/apple-app-site-association')).json();
  expect(aasa.applinks.details[0].components).toContainEqual({ '/': '/join/*' });
  expect((await request.get('/.well-known/assetlinks.json')).ok()).toBe(true);
});
