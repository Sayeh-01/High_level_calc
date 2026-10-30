import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

test('chore → kid completes on a shared device → parent approves → kid redeems; Arabic screens', async ({ browser }) => {
  const P = await newUser(browser, 'Mama');
  await P.page.goto('/new-group');
  await P.page.getByTestId('template-family').click();
  await P.page.getByTestId('group-name').fill('Home');
  await P.page.getByTestId('create-group').click();
  await P.page.getByTestId('invite-done').click();
  const groupId = new URL(P.page.url()).pathname.split('/')[2];

  // parent adds a child and a reward
  await P.page.goto(`/g/${groupId}/settings`);
  await P.page.getByTestId('add-child').click();
  await P.page.getByTestId('child-name').fill('Lina');
  await P.page.getByTestId('child-pin').fill('2468');
  await P.page.getByTestId('child-save').click();
  await expect(P.page.getByTestId('settings-screen')).toContainText('Lina');
  const children = await (await P.page.request.get('/api/me/children')).json();
  const childId = children[0].id;
  await P.page.request.post(`/api/groups/${groupId}/tasks`, { data: { title: 'Tidy your room', points: 30, assigneeId: childId } });
  await P.page.goto(`/g/${groupId}/points`);
  await P.page.getByTestId('new-reward').click();
  await P.page.getByTestId('reward-title').fill('Extra hour of games');
  await P.page.getByTestId('reward-cost').fill('30');
  await P.page.getByTestId('reward-save').click();
  await expect(P.page.getByTestId('group-screen-points')).toContainText('Extra hour of games');

  // a shared tablet: the parent signs in there too, then switches it to Lina with her PIN
  const tablet = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await tablet.addCookies(await P.ctx.cookies());
  const D = { ctx: tablet, page: await tablet.newPage(), errors: [] as string[] };
  D.page.on('pageerror', (e) => D.errors.push(e.message));
  await D.page.goto('/me');
  await D.page.getByTestId(`switch-kid-${childId}`).click();
  await D.page.getByTestId('kid-pin').fill('1111');
  await D.page.getByTestId('kid-pin-submit').click();
  await expect(D.page.getByText('Wrong PIN')).toBeVisible();
  await D.page.getByTestId('kid-pin').fill('2468');
  await D.page.getByTestId('kid-pin-submit').click();
  await expect(D.page.getByTestId('kids-home')).toBeVisible();
  await expect(D.page.getByTestId('kids-home')).toContainText('Lina');
  // no money tab, no quick-add for kids
  await expect(D.page.getByTestId('tab-capture')).toHaveCount(0);

  // Lina finishes her chore → waits for approval
  await D.page.getByText('Tidy your room').click();
  await expect(D.page.getByTestId('kids-home')).toContainText('All done');
  await P.page.reload();
  const approve = P.page.locator('[data-testid^="approve-"]');
  await expect(approve).toHaveCount(1);
  await approve.click();
  await expect(P.page.getByTestId('fairness')).toContainText('100%');

  // Lina sees 30 points and buys the reward
  await D.page.goto(`/g/${groupId}/points`);
  await expect(D.page.getByTestId('my-points')).toContainText('30');
  await D.page.locator('[data-testid^="redeem-"]').click();
  await expect(D.page.getByTestId('my-points')).toContainText('0');
  // money is not reachable for a Child
  const money = await D.page.request.get(`/api/groups/${groupId}/balances`);
  expect(money.status()).toBe(403);

  // Arabic
  await setLanguage(P.page, 'ar');
  await P.page.goto(`/g/${groupId}/points`);
  await expect(P.page.getByTestId('fairness')).toBeVisible();
  await shoot(P.page, 'v1.2', 'ar-points');
  await P.page.goto('/me');
  await expect(P.page.getByTestId('kids-switcher')).toBeVisible();
  await shoot(P.page, 'v1.2', 'ar-me-kids');
  await setLanguage(D.page, 'ar');
  await D.page.goto('/');
  await expect(D.page.getByTestId('kids-home')).toBeVisible();
  await shoot(D.page, 'v1.2', 'ar-kids-home');
  expect(P.errors).toEqual([]);
  expect(D.errors).toEqual([]);
});
