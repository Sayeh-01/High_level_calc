import { expect, test, type Page } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

async function createGroup(page: Page, template: string, name: string) {
  await page.goto('/new-group');
  await page.getByTestId(`template-${template}`).click();
  await page.getByTestId('group-name').fill(name);
  await page.getByTestId('create-group').click();
  const code = (await page.getByTestId('invite-code').textContent())!.trim();
  await page.getByTestId('invite-done').click();
  return { code, gid: new URL(page.url()).pathname.split('/')[2] };
}

async function joinGroup(page: Page, code: string) {
  await page.goto(`/join/${code}`);
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('group-screen-home')).toBeVisible();
}

async function draw(page: Page) {
  const box = (await page.getByTestId('signature-pad').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 90);
  await page.mouse.down();
  for (const [dx, dy] of [[60, 40], [90, 95], [120, 35], [150, 90], [190, 50], [230, 85]]) await page.mouse.move(box.x + dx, box.y + dy, { steps: 4 });
  await page.mouse.up();
}

test('khatma split and rotation; a form signed on the pad and shown to the coordinator; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');

  // Faith: khatma of 30 juz' between two members
  const faith = await createGroup(A.page, 'faith', 'Ramadan circle');
  await joinGroup(B.page, faith.code);
  await A.page.goto(`/g/${faith.gid}/challenges`);
  await expect(A.page.getByTestId('hijri-date')).toBeVisible();
  await A.page.getByTestId('new-challenge').click();
  await expect(A.page.getByTestId('challenge-title')).toHaveValue('Khatma (30 juz’)');
  await A.page.getByTestId('challenge-save').click();
  await expect(A.page.getByTestId('challenge-summary')).toContainText('0 of 30 done');
  await expect(A.page.getByTestId('part-done-1')).toBeVisible();
  await expect(A.page.getByTestId('part-done-15')).toBeVisible();
  await A.page.getByTestId('part-done-1').click();
  await expect(A.page.getByTestId('challenge-summary')).toContainText('1 of 30 done');
  const path = new URL(A.page.url()).pathname;

  // Bassem hands part 16 back; Amal takes it from the grid
  await B.page.goto(path);
  await B.page.getByTestId('part-handback-16').click();
  await A.page.reload();
  await A.page.getByTestId('part-16').click();
  await expect(A.page.getByTestId('part-done-16')).toBeVisible();

  // next round: blocks rotate — Amal now reads 16–30
  await A.page.getByTestId('challenge-next').click();
  await expect(A.page.getByTestId('challenge-summary')).toContainText('Round 2');
  await expect(A.page.getByTestId('part-done-16')).toBeVisible();
  await expect(A.page.getByTestId('part-done-30')).toBeVisible();
  await expect(A.page.getByTestId('part-done-1')).toHaveCount(0);

  // Volunteer: a consent form with a signature
  const vol = await createGroup(A.page, 'volunteer', 'Food bank');
  await joinGroup(B.page, vol.code);
  await A.page.goto(`/g/${vol.gid}/forms`);
  await A.page.getByTestId('new-form').click();
  await A.page.getByTestId('form-title').fill('Saturday trip consent');
  await A.page.getByTestId('form-description').fill('The bus leaves at 8.');
  await A.page.getByTestId('field-label').fill('I agree to the trip rules');
  await A.page.getByTestId('field-add').click();
  await A.page.getByTestId('form-save').click();
  await expect(A.page.getByTestId('form-summary')).toContainText('0 of 2 answered');
  const formPath = new URL(A.page.url()).pathname;

  await B.page.goto(formPath);
  await B.page.getByTestId('answer-q1').getByRole('tab', { name: 'Yes' }).click();
  await expect(B.page.getByTestId('form-submit')).toBeDisabled();
  await draw(B.page);
  await B.page.getByTestId('form-submit').click();
  await expect(B.page.getByTestId('form-mine')).toContainText('Signed ✓');
  await expect(B.page.getByTestId('form-mine')).toContainText('Signed by Bassem');
  const bId = (await (await B.page.request.get('/api/me')).json()).id;
  const stored = await (await A.page.request.get(`/api/groups/${vol.gid}/forms/${formPath.split('/').pop()}`)).json();
  expect(stored.responses[0].signature.path).toMatch(/^M\d+ \d+(L\d+ \d+)+/);
  await A.page.reload();
  await expect(A.page.getByTestId('form-summary')).toContainText('1 of 2 answered');
  await expect(A.page.getByTestId(`signature-${bId}`)).toBeVisible();
  expect(await A.page.getByTestId(`signature-${bId}`).locator('div').count()).toBeGreaterThan(5);

  await setLanguage(A.page, 'ar');
  await A.page.goto(formPath);
  await expect(A.page.getByTestId(`signature-${bId}`)).toBeVisible();
  await shoot(A.page, 'v2.8', 'ar-form-responses');
  await A.page.goto(path);
  await expect(A.page.getByTestId('challenge-grid')).toBeVisible();
  await shoot(A.page, 'v2.8', 'ar-khatma');
  await A.page.goto(`/g/${faith.gid}/challenges`);
  await expect(A.page.getByTestId('hijri-date')).toBeVisible();
  await shoot(A.page, 'v2.8', 'ar-challenges');
  await setLanguage(B.page, 'ar');
  await B.page.goto(formPath);
  await expect(B.page.getByTestId('my-signature')).toBeVisible();
  await shoot(B.page, 'v2.8', 'ar-form-signed');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
