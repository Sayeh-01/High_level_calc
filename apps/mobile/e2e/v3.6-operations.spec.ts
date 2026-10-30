import { expect, test, type Page } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

const userId = async (page: Page) => (await (await page.request.get('/api/me')).json()).id as string;

test('inventory low-stock alert once and reorder; asset service; spend approval by limit; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-company').click();
  await A.page.getByTestId('group-name').fill('Cafe Nile');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();

  // stock: Milk 6, alert at 5
  await A.page.goto(`/g/${gid}/inventory`);
  await A.page.getByTestId('new-item').click();
  await A.page.getByTestId('item-name').fill('Milk');
  await A.page.getByTestId('item-qty').fill('6');
  await A.page.getByTestId('item-low').fill('5');
  await A.page.getByTestId('item-save').click();
  const item = (await (await A.page.request.get(`/api/groups/${gid}/inventory`)).json())[0];
  await B.page.goto(`/g/${gid}/inventory`);
  await B.page.getByTestId(`use-${item.id}`).click();
  await expect(B.page.getByTestId(`qty-${item.id}`)).toHaveText('5');
  await B.page.getByTestId(`use-${item.id}`).click();
  await expect(B.page.getByTestId(`qty-${item.id}`)).toHaveText('4');
  await A.page.goto('/inbox');
  await expect(A.page.getByTestId('inbox-screen')).toContainText('Low stock: Milk');
  const lows = (await (await A.page.request.get('/api/me/inbox')).json()).filter((n: any) => n.kind === 'low_stock');
  expect(lows).toHaveLength(1);
  await A.page.goto(`/g/${gid}/inventory`);
  await A.page.getByTestId(`reorder-${item.id}`).click();
  await A.page.getByTestId('reorder-qty').fill('24');
  await A.page.getByTestId('reorder-save').click();
  await A.page.goto(`/g/${gid}/tasks`);
  await expect(A.page.getByTestId('group-screen-tasks')).toContainText('Reorder 24 Milk');

  // equipment
  await A.page.goto(`/g/${gid}/assets`);
  await A.page.getByTestId('new-asset').click();
  await A.page.getByTestId('asset-name').fill('Espresso machine');
  await A.page.getByTestId('asset-save').click();
  await A.page.locator('[data-testid^="service-"]').first().click();
  await A.page.getByTestId('service-note').fill('Descaled');
  await A.page.getByTestId('service-save').click();
  await expect(A.page.locator('[data-testid^="asset-"]').first()).toContainText('Next service');

  // spending: members may spend 50.00 alone; above that the owner approves
  expect((await A.page.request.put(`/api/groups/${gid}/spend-requests/limits`, { data: { limits: { member: 5000, manager: 50000 } } })).ok()).toBe(true);
  await B.page.goto(`/g/${gid}/approvals`);
  for (const [title, amount] of [['Napkins', '30'], ['Blender', '150']]) {
    await B.page.getByTestId('new-request').click();
    await B.page.getByTestId('request-title').fill(title);
    await B.page.getByTestId('request-amount').fill(amount);
    await B.page.getByTestId('request-save').click();
  }
  await expect(B.page.getByTestId('group-screen-approvals')).toContainText('auto, within the limit');
  await expect(B.page.getByTestId('group-screen-approvals')).toContainText('Waiting for approval');
  await A.page.goto(`/g/${gid}/approvals`);
  await A.page.locator('[data-testid^="approve-"]').click();
  await expect(A.page.locator('[data-testid^="approve-"]')).toHaveCount(0);
  const reqs = (await (await A.page.request.get(`/api/groups/${gid}/spend-requests`)).json()).requests;
  expect(reqs.map((r: any) => r.status).sort()).toEqual(['approved', 'approved']);
  expect(await userId(B.page)).toBeTruthy();

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${gid}/inventory`);
  await expect(A.page.getByTestId(`item-${item.id}`)).toBeVisible();
  await shoot(A.page, 'v3.6', 'ar-inventory');
  await A.page.goto(`/g/${gid}/assets`);
  await expect(A.page.locator('[data-testid^="asset-"]').first()).toBeVisible();
  await shoot(A.page, 'v3.6', 'ar-assets');
  await A.page.goto(`/g/${gid}/approvals`);
  await expect(A.page.getByTestId('my-limit')).toBeVisible();
  await shoot(A.page, 'v3.6', 'ar-approvals');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
