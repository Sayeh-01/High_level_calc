import { expect, test, type Page } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

// a 1×1 PNG for the receipt photo (the AI_FAKE model answers with a demo receipt)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function createGroup(page: Page, template: string, name: string) {
  await page.goto('/new-group');
  await page.getByTestId(`template-${template}`).click();
  await page.getByTestId('group-name').fill(name);
  await page.getByTestId('create-group').click();
  const code = (await page.getByTestId('invite-code').textContent())!.trim();
  await page.getByTestId('invite-done').click();
  return { code, gid: new URL(page.url()).pathname.split('/')[2] };
}

test('trip in two currencies, budgets, receipt scan draft, dues; event guest list with plus-ones; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');

  const trip = await createGroup(A.page, 'trip', 'Rome trip');
  await B.page.goto(`/join/${trip.code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();

  // a euro expense at a manual rate is stored in the group currency
  await A.page.goto(`/g/${trip.gid}/expenses`);
  await A.page.getByTestId('new-expense').click();
  await A.page.getByTestId('expense-title').fill('Dinner in Trastevere');
  await A.page.getByTestId('expense-amount').fill('90');
  await A.page.getByTestId('expense-currency').fill('EUR');
  await A.page.getByTestId('expense-rate').fill('52.5');
  await expect(A.page.getByTestId('expense-converted')).toContainText('4,725');
  await A.page.getByTestId('expense-category').fill('Food');
  await A.page.getByTestId('expense-save').click();
  await expect(A.page.getByTestId('group-screen-expenses')).toContainText('paid in EUR at 52.5');
  await expect(A.page.getByTestId('balances-card')).toContainText('2,362.50');

  // whole-trip budget
  await A.page.goto(`/g/${trip.gid}/budgets`);
  await A.page.getByTestId('new-budget').click();
  await A.page.getByTestId('budget-amount').fill('5000');
  await A.page.getByRole('tab', { name: 'Whole trip / event' }).click();
  await A.page.getByTestId('budget-save').click();
  await expect(A.page.getByTestId('group-screen-budgets')).toContainText('95%');

  // receipt scan fills a draft; nothing is saved until Save
  await A.page.goto(`/g/${trip.gid}/expenses`);
  const chooser = A.page.waitForEvent('filechooser');
  await A.page.getByTestId('scan-receipt').click();
  await (await chooser).setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(A.page.getByTestId('scan-hint')).toBeVisible();
  await expect(A.page.getByTestId('expense-title')).toHaveValue('Receipt (demo scan)');
  await expect(A.page.getByTestId('expense-amount')).toHaveValue('250');
  const before = await A.page.request.get(`/api/groups/${trip.gid}/expenses`);
  expect((await before.json()).length).toBe(1);
  await A.page.keyboard.press('Escape');

  // dues: switch the module on, collect a fee, B reports, A confirms
  await A.page.goto(`/g/${trip.gid}/settings`);
  await A.page.getByTestId('toggle-module-dues').click();
  await A.page.goto(`/g/${trip.gid}/dues`);
  await A.page.getByTestId('new-due').click();
  await A.page.getByTestId('due-title').fill('Museum pass');
  await A.page.getByTestId('due-amount').fill('500');
  await A.page.getByRole('tab', { name: 'Once' }).click();
  await A.page.getByTestId('due-save').click();
  await expect(A.page.getByTestId('group-screen-dues')).toContainText('Museum pass');
  await B.page.goto(`/g/${trip.gid}/dues`);
  await B.page.getByText('I paid').click();
  await expect(B.page.getByTestId('charge-me')).toContainText('Says paid');
  await A.page.reload();
  await A.page.getByTestId(`due-confirm-${await userId(B.page)}`).click();
  await expect(A.page.locator('[data-testid^="due-collected-"]')).toContainText('500');

  // event: guest list, RSVP through the link without the app, plus-ones counted
  const party = await createGroup(A.page, 'event', 'Nour wedding');
  await A.page.goto(`/g/${party.gid}/guests`);
  await A.page.getByTestId('new-guest').click();
  await A.page.getByTestId('guest-name').fill('Aunt Hoda');
  await A.page.getByTestId('guest-max-plus').fill('2');
  await A.page.getByTestId('guest-save').click();
  await expect(A.page.getByTestId('group-screen-guests')).toContainText('Aunt Hoda');
  const list = await (await A.page.request.get(`/api/groups/${party.gid}/guests`)).json();
  const url = new URL(list.guests[0].url);
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await visitor.newPage();
  await guestPage.goto(url.pathname);
  await guestPage.getByTestId('guest-plus').fill('2');
  await guestPage.getByTestId('guest-going').click();
  await expect(guestPage.locator('.status')).toContainText('+2');
  await A.page.reload();
  await expect(A.page.getByTestId('guest-headcount')).toHaveText('3');

  // contacts (vendors)
  await A.page.goto(`/g/${party.gid}/contacts`);
  await A.page.getByTestId('new-contact').click();
  await A.page.getByTestId('contact-name').fill('Zahra Flowers');
  await A.page.getByTestId('contact-phone').fill('+20 100 123 4567');
  await A.page.getByTestId('contact-save').click();
  await expect(A.page.getByTestId('group-screen-contacts')).toContainText('Zahra Flowers');

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${party.gid}/guests`);
  await expect(A.page.getByTestId('guest-headcount')).toBeVisible();
  await shoot(A.page, 'v2.0', 'ar-guests');
  await A.page.goto(`/g/${party.gid}/contacts`);
  await expect(A.page.getByTestId('group-screen-contacts')).toContainText('Zahra Flowers');
  await shoot(A.page, 'v2.0', 'ar-contacts');
  await A.page.goto(`/g/${trip.gid}/expenses`);
  await expect(A.page.getByTestId('balances-card')).toBeVisible();
  await shoot(A.page, 'v2.0', 'ar-expenses');
  await A.page.getByTestId('new-expense').click();
  await A.page.getByTestId('expense-currency').fill('USD');
  await A.page.getByTestId('expense-amount').fill('30');
  await A.page.getByTestId('expense-rate').fill('48');
  await expect(A.page.getByTestId('expense-converted')).toBeVisible();
  await shoot(A.page, 'v2.0', 'ar-expense-currency');
  await A.page.keyboard.press('Escape');
  await A.page.goto(`/g/${trip.gid}/budgets`);
  await expect(A.page.locator('[data-testid^="budget-pct-"]')).toBeVisible();
  await shoot(A.page, 'v2.0', 'ar-budgets');
  await A.page.goto(`/g/${trip.gid}/dues`);
  await expect(A.page.getByTestId('group-screen-dues')).toContainText('Museum pass');
  await shoot(A.page, 'v2.0', 'ar-dues');
  await guestPage.goto(`${url.pathname}?lang=ar`);
  await expect(guestPage.locator('html')).toHaveAttribute('dir', 'rtl');
  await shoot(guestPage, 'v2.0', 'ar-guest-page');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});

async function userId(page: Page): Promise<string> {
  const me = await (await page.request.get('/api/me')).json();
  return me.user?.id ?? me.id;
}
