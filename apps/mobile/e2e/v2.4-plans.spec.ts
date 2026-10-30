import { expect, test, type APIRequestContext } from '@playwright/test';
import { newUser, setLanguage, shoot, uniqueEmail } from './helpers';

test('Free cap: the 16th member is turned away with an upgrade message; paywall for Group Pro and Plus; Arabic', async ({ browser, playwright, baseURL }) => {
  const A = await newUser(browser, 'Amal');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-sport').click();
  await A.page.getByTestId('group-name').fill('Sunday League');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];

  // 14 players join through the API (each with a real session)
  const ctxs: APIRequestContext[] = [];
  for (let i = 1; i <= 14; i++) {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL! } });
    const email = uniqueEmail(`player${i}`);
    expect((await ctx.post('/api/auth/email-otp/send-verification-otp', { data: { email, type: 'sign-in' } })).ok()).toBe(true);
    const { code: otp } = await (await ctx.get(`/api/test/otp?email=${encodeURIComponent(email)}`)).json();
    expect((await ctx.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(true);
    expect((await ctx.post(`/api/invites/${code}/join`, { data: { displayName: `Player ${i}` } })).ok()).toBe(true);
    ctxs.push(ctx);
  }

  // number 16 opens the link: the group is full, no Join button; forcing the API gets 402
  const Z = await newUser(browser, 'Zeina');
  await Z.page.goto(`/join/${code}`);
  await expect(Z.page.getByTestId('join-full')).toContainText('full (15 members)');
  await expect(Z.page.getByTestId('join-submit')).toHaveCount(0);
  const forced = await Z.page.request.post(`/api/invites/${code}/join`, { data: {} });
  expect(forced.status()).toBe(402);
  expect((await forced.json()).error).toBe('upgrade_required');

  // the organizer sees why and where to upgrade
  await A.page.goto('/inbox');
  await expect(A.page.getByTestId('inbox-screen')).toContainText("couldn't join");
  await A.page.goto(`/g/${gid}/invite`);
  await expect(A.page.getByTestId('invite-seats')).toContainText('15 of 15');
  await A.page.getByTestId('invite-upgrade').click();
  await expect(A.page.getByTestId('paywall-screen')).toBeVisible();
  await expect(A.page.getByTestId('paywall-group-status')).toContainText('Free');
  await A.page.getByTestId('buy-group_pro').click();
  await expect(A.page.getByTestId('paywall-store-soon')).toBeVisible();
  // nothing changed on the server: the button can't grant a plan
  expect((await (await A.page.request.get(`/api/groups/${gid}/plan`)).json()).plan).toBe('free');
  await A.page.goto(`/g/${gid}/settings`);
  await expect(A.page.getByTestId('settings-plan')).toContainText('15 of 15 members');
  await A.page.goto('/me');
  await A.page.getByTestId('me-plus').click();
  await expect(A.page.getByTestId('plan-plus')).toContainText('AI assistant');

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/paywall?plan=group_pro&groupId=${gid}`);
  await expect(A.page.getByTestId('plan-group_pro')).toBeVisible();
  await shoot(A.page, 'v2.4', 'ar-paywall-group');
  await A.page.goto(`/g/${gid}/invite`);
  await expect(A.page.getByTestId('invite-full')).toBeVisible();
  await shoot(A.page, 'v2.4', 'ar-invite-full');
  await A.page.goto('/me');
  await expect(A.page.getByTestId('me-plus')).toBeVisible();
  await shoot(A.page, 'v2.4', 'ar-me-plus');
  await setLanguage(Z.page, 'ar');
  await Z.page.goto(`/join/${code}`);
  await expect(Z.page.getByTestId('join-full')).toBeVisible();
  await shoot(Z.page, 'v2.4', 'ar-join-full');
  for (const c of ctxs) await c.dispose();
  expect(A.errors).toEqual([]);
  expect(Z.errors).toEqual([]);
});
