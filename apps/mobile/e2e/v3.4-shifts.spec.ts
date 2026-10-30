import { expect, test, type Page } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

const userId = async (page: Page) => (await (await page.request.get('/api/me')).json()).id as string;

test('shifts with overlap check, swap approved by the manager, QR/typed clock-in; Arabic', async ({ browser }) => {
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

  // the manager schedules Bassem tomorrow 09:00–17:00
  await A.page.goto(`/g/${gid}/shifts`);
  await A.page.getByTestId('new-shift').click();
  await A.page.getByTestId(`shift-who-${b}`).click();
  await A.page.getByTestId('shift-label').fill('Bar');
  await A.page.getByTestId('shift-save').click();
  await expect(A.page.getByTestId('shift-sheet')).toHaveCount(0);
  const list = await (await A.page.request.get(`/api/groups/${gid}/shifts`)).json();
  const s = list.shifts[0];
  await expect(A.page.getByTestId(`shift-${s.id}`)).toContainText('Bar');
  await expect(A.page.getByTestId(`shift-${s.id}`)).toContainText('Bassem');
  // an overlapping shift for the same person is refused
  const clash = await A.page.request.post(`/api/groups/${gid}/shifts`, { data: { userId: b, startsAt: new Date(new Date(s.startsAt).getTime() + 7 * 3600_000).toISOString(), endsAt: new Date(new Date(s.endsAt).getTime() + 3 * 3600_000).toISOString() } });
  expect(clash.status()).toBe(409);

  // Bassem asks Carla to take it; Carla agrees; it only changes hands when the manager approves
  await B.page.goto(`/g/${gid}/shifts`);
  await B.page.getByTestId(`swap-open-${s.id}`).click();
  await B.page.getByTestId(`swap-to-${c}`).click();
  await C.page.goto(`/g/${gid}/shifts`);
  await C.page.locator('[data-testid^="swap-accept-"]').click();
  await expect(C.page.locator('[data-testid^="swap-"]').first()).toContainText('Waiting for a manager');
  await expect(C.page.getByTestId(`shift-${s.id}`)).toContainText('Bassem');
  await A.page.reload();
  await A.page.locator('[data-testid^="swap-approve-"]').click();
  await expect(A.page.getByTestId(`shift-${s.id}`)).toContainText('Carla');

  // time clock: the manager's screen shows the code; Bassem types it
  await A.page.goto(`/g/${gid}/clock`);
  const shown = (await A.page.getByTestId('clock-shown-code').textContent())!.trim();
  expect(shown).toMatch(/^\d{6}$/);
  await B.page.goto(`/g/${gid}/clock?code=${shown}`);
  await expect(B.page.getByTestId('clock-code')).toHaveValue(shown);
  await B.page.getByTestId('clock-punch').click();
  await expect(B.page.getByTestId('clock-status')).toContainText('Clocked in since');
  expect((await B.page.request.post(`/api/groups/${gid}/clock/in`, { data: { code: '000000' } })).status()).toBeGreaterThanOrEqual(400);

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${gid}/shifts`);
  await expect(A.page.getByTestId(`shift-${s.id}`)).toContainText('Carla');
  await shoot(A.page, 'v3.4', 'ar-shifts');
  await A.page.goto(`/g/${gid}/clock`);
  await expect(A.page.getByTestId('clock-qr')).toBeVisible();
  await shoot(A.page, 'v3.4', 'ar-clock-manager');
  await setLanguage(B.page, 'ar');
  await B.page.goto(`/g/${gid}/clock`);
  await expect(B.page.getByTestId('clock-status')).toBeVisible();
  await shoot(B.page, 'v3.4', 'ar-clock-staff');
  for (const u of [A, B, C]) expect(u.errors).toEqual([]);
});
