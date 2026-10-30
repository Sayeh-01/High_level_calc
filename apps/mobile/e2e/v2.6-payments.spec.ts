import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

test('pay a debt online through the (fake) gateway with a fee and a receipt; a declined due; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-roommates').click();
  await A.page.getByTestId('group-name').fill('Flat 4B');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();
  const aId = (await (await A.page.request.get('/api/me')).json()).id;

  // A pays 300 for both → B owes 150
  await A.page.goto(`/g/${gid}/expenses`);
  await A.page.getByTestId('new-expense').click();
  await A.page.getByTestId('expense-title').fill('Electricity');
  await A.page.getByTestId('expense-amount').fill('300');
  await A.page.getByTestId('expense-save').click();
  await expect(A.page.getByTestId('balances-card')).toContainText('150');

  // B pays online: 150.00 + 1.5% fee (2.25) = 152.25 at the gateway
  await B.page.goto(`/g/${gid}/expenses`);
  await B.page.getByTestId(`pay-online-${aId}`).click();
  await expect(B.page.getByTestId('pay-fee')).toContainText('2.25');
  await expect(B.page.getByTestId('pay-total')).toContainText('152.25');
  await B.page.getByTestId('pay-continue').click();
  await expect(B.page.getByTestId('fake-total')).toHaveText('152.25 EGP');
  await B.page.getByTestId('fake-pay').click();
  await expect(B.page.getByTestId('payment-status')).toHaveText('Paid ✓');
  await expect(B.page.getByTestId('payment-receipt')).toContainText(/CIR-\d{4}-\d{6}/);
  const pid = new URL(B.page.url()).pathname.split('/').pop();
  const receipt = await (await B.page.request.get(`/api/groups/${gid}/payments/${pid}/receipt`)).json();
  expect(receipt.html).toContain('152.25');
  await B.page.goto(`/g/${gid}/expenses`);
  await expect(B.page.getByTestId('balances-card')).toContainText('settled');

  // a due whose total ends in .13 is declined by the fake gateway (9.98 + 0.15 fee = 10.13)
  await A.page.goto(`/g/${gid}/settings`);
  await A.page.getByTestId('toggle-module-dues').click();
  await A.page.goto(`/g/${gid}/dues`);
  await A.page.getByTestId('new-due').click();
  await A.page.getByTestId('due-title').fill('Cleaning');
  await A.page.getByTestId('due-amount').fill('9.98');
  await A.page.getByTestId('due-save').click();
  await B.page.goto(`/g/${gid}/dues`);
  await B.page.locator('[data-testid^="due-pay-"]').click();
  await expect(B.page.getByTestId('pay-total')).toContainText('10.13');
  await B.page.getByTestId('pay-continue').click();
  await B.page.getByTestId('fake-pay').click();
  await expect(B.page.getByTestId('payment-status')).toHaveText('Payment failed');
  await expect(B.page.getByTestId('payment-screen')).toContainText('The card was declined');

  await setLanguage(B.page, 'ar');
  await B.page.goto(`/g/${gid}/payment/${pid}`);
  await expect(B.page.getByTestId('payment-receipt')).toBeVisible();
  await shoot(B.page, 'v2.6', 'ar-payment-paid');
  await B.page.goto(`/g/${gid}/dues`);
  await B.page.locator('[data-testid^="due-pay-"]').click();
  await expect(B.page.getByTestId('pay-total')).toBeVisible();
  await shoot(B.page, 'v2.6', 'ar-pay-sheet');
  await B.page.keyboard.press('Escape');
  await B.page.goto(`/g/${gid}/expenses`);
  await expect(B.page.getByTestId('balances-card')).toBeVisible();
  await shoot(B.page, 'v2.6', 'ar-expenses-settled');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
