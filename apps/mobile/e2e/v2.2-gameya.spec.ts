import { expect, test, type Page } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

const userId = async (page: Page) => (await (await page.request.get('/api/me')).json()).id as string;

test('gam’eya: agreed order, payment board confirmed by the receiver, swap needs both members + organizer; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  const C = await newUser(browser, 'Carla');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-savings').click();
  await A.page.getByTestId('group-name').fill('Office gameya');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  for (const u of [B, C]) {
    await u.page.goto(`/join/${code}`);
    await u.page.getByTestId('join-submit').click();
    await expect(u.page.getByTestId('group-screen-home')).toBeVisible();
  }
  const [a, b, c] = [await userId(A.page), await userId(B.page), await userId(C.page)];

  // start a round in an agreed order: Amal, Bassem, Carla
  await A.page.goto(`/g/${gid}/gameya`);
  await A.page.getByTestId('new-gameya').click();
  await A.page.getByTestId('gameya-amount').fill('2000');
  for (const u of [a, b, c]) await A.page.getByTestId(`gameya-member-${u}`).click(); // all start selected: clear them
  for (const u of [a, b, c]) await A.page.getByTestId(`gameya-member-${u}`).click(); // then pick in payout order
  await expect(A.page.getByTestId(`gameya-member-${c}`)).toContainText('3.');
  await A.page.getByTestId('gameya-save').click();
  await expect(A.page.getByTestId('gameya-summary')).toContainText('6,000');
  await expect(A.page.getByTestId('gameya-month-1')).toContainText('Receives: You');
  await expect(A.page.getByTestId('gameya-month-3')).toContainText('Carla');
  const board = A.page.url();
  const path = new URL(board).pathname;

  // B and C pay month 1; only Amal (the receiver) can confirm
  for (const u of [B, C]) {
    await u.page.goto(path);
    await u.page.getByTestId('gameya-report-1').click();
    await expect(u.page.getByTestId('gp-1-me')).toContainText('Says paid');
    await expect(u.page.locator('[data-testid^="gameya-confirm-1-"]')).toHaveCount(0);
  }
  await A.page.reload();
  await A.page.getByTestId(`gameya-confirm-1-${b}`).click();
  await A.page.getByTestId(`gameya-confirm-1-${c}`).click();
  await expect(A.page.getByTestId('gameya-month-1')).toContainText('Pot received');

  // Today shows the circle for Bassem
  await B.page.goto('/');
  await expect(B.page.locator('[data-testid^="today-gameya-"]')).toContainText('Your turn: month 2');

  // B asks C to swap; C agrees → still waiting for the organizer; Amal approves → swapped
  await B.page.goto(path);
  await B.page.getByTestId('gameya-swap').click();
  await B.page.getByTestId(`swap-with-${c}`).click();
  await C.page.goto(path);
  await C.page.locator('[data-testid^="swap-accept-"]').click();
  await expect(C.page.locator('[data-testid^="swap-"]').first()).toContainText('Waiting for an organizer');
  await expect(C.page.getByTestId('gameya-month-2')).toContainText('Bassem');
  await A.page.reload();
  await A.page.locator('[data-testid^="swap-approve-"]').click();
  await expect(A.page.getByTestId('gameya-month-2')).toContainText('Carla');
  await expect(A.page.getByTestId('gameya-month-3')).toContainText('Bassem');

  await setLanguage(A.page, 'ar');
  await A.page.goto(path);
  await expect(A.page.getByTestId('gameya-trust')).toBeVisible();
  await shoot(A.page, 'v2.2', 'ar-gameya-board');
  await A.page.goto(`/g/${gid}/gameya`);
  await expect(A.page.locator('[data-testid^="gameya-"]').first()).toBeVisible();
  await shoot(A.page, 'v2.2', 'ar-gameya-list');
  await A.page.getByTestId('new-gameya').click();
  await A.page.getByTestId('gameya-amount').fill('1000');
  await shoot(A.page, 'v2.2', 'ar-gameya-new');
  await setLanguage(B.page, 'ar');
  await B.page.goto('/');
  await expect(B.page.locator('[data-testid^="today-gameya-"]')).toBeVisible();
  await shoot(B.page, 'v2.2', 'ar-today-gameya');
  for (const u of [A, B, C]) expect(u.errors).toEqual([]);
});
