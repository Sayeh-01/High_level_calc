import { expect, test, type Page } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const userId = async (page: Page) => (await (await page.request.get('/api/me')).json()).id as string;

test('company: custom role, department, opening checklist with photo proof; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  const C = await newUser(browser, 'Carla');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-company').click();
  await A.page.getByTestId('group-name').fill('Cafe Nile');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  for (const u of [B, C]) {
    await u.page.goto(`/join/${code}`);
    await u.page.getByTestId('join-submit').click();
    await expect(u.page.getByTestId('group-screen-home')).toBeVisible();
  }
  const [b, c] = [await userId(B.page), await userId(C.page)];

  // a Cashier role: can add expenses, can't add tasks
  await A.page.goto(`/g/${gid}/settings`);
  await A.page.getByTestId('open-team').click();
  await A.page.getByTestId('new-role').click();
  await A.page.getByTestId('role-name').fill('Cashier');
  await A.page.getByTestId('grant-money.write').click();
  await A.page.getByTestId('deny-items.create').click();
  await A.page.getByTestId('role-save').click();
  await expect(A.page.getByTestId('role-cashier')).toContainText('Add expenses');
  await A.page.getByTestId(`assign-${b}-cashier`).click();
  await expect(A.page.getByTestId('team-screen')).toContainText('Bassem · Cashier');
  expect((await B.page.request.post(`/api/groups/${gid}/tasks`, { data: { title: 'nope' } })).status()).toBe(403);

  // a Kitchen department with Carla
  await A.page.getByTestId('new-department').click();
  await A.page.getByTestId('department-name').fill('Kitchen');
  await A.page.getByTestId(`dept-member-${c}`).click();
  await A.page.getByTestId('department-save').click();
  await expect(A.page.locator('[data-testid^="department-"]').first()).toContainText('Kitchen');
  await C.page.goto(`/g/${gid}`);
  await expect(C.page.locator('[data-testid^="home-department-"]')).toContainText('Kitchen');
  await B.page.goto(`/g/${gid}`);
  await expect(B.page.locator('[data-testid^="home-department-"]')).toHaveCount(0);

  // opening checklist with photo proof
  await A.page.goto(`/g/${gid}/checklists`);
  await A.page.getByTestId('new-checklist').click();
  await A.page.getByTestId('checklist-title').fill('Opening');
  await A.page.getByTestId('checklist-items').fill('Unlock and lights on\n📷 Coffee machine on');
  await A.page.getByTestId('checklist-save').click();
  await C.page.goto(`/g/${gid}/checklists`);
  await C.page.locator('[data-testid^="checklist-"]').first().click();
  await C.page.getByTestId('check-i1').click();
  await expect(C.page.getByTestId('checked-i1')).toContainText('Carla');
  const chooser = C.page.waitForEvent('filechooser');
  await C.page.getByTestId('photo-i2').click();
  await (await chooser).setFiles({ name: 'machine.png', mimeType: 'image/png', buffer: PNG });
  await expect(C.page.getByTestId('checked-i2')).toContainText('Carla');
  await expect(C.page.getByTestId('checklist-run')).toContainText('Completed');
  await A.page.goto(`/g/${gid}/checklists`);
  await expect(A.page.locator('[data-testid^="checklist-"]').first()).toContainText('Completed');

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${gid}/team`);
  await expect(A.page.getByTestId('role-cashier')).toBeVisible();
  await shoot(A.page, 'v3.2', 'ar-team');
  await A.page.goto(`/g/${gid}/checklists`);
  await expect(A.page.locator('[data-testid^="checklist-"]').first()).toBeVisible();
  await shoot(A.page, 'v3.2', 'ar-checklists');
  await setLanguage(C.page, 'ar');
  await C.page.goto(`/g/${gid}`);
  await expect(C.page.locator('[data-testid^="home-department-"]')).toBeVisible();
  await shoot(C.page, 'v3.2', 'ar-home-departments');
  await C.page.goto(`/g/${gid}/checklists`);
  await C.page.locator('[data-testid^="checklist-"]').first().click();
  await expect(C.page.getByTestId('checked-i2')).toBeVisible();
  await shoot(C.page, 'v3.2', 'ar-checklist-run');
  for (const u of [A, B, C]) expect(u.errors).toEqual([]);
});
