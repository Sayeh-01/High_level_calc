import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

test('care circle: vault with folder access, meds, emergency card, arrived safely; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-care').click();
  await A.page.getByTestId('group-name').fill('Care for Dad');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();

  // vault: a shared folder and an admins-only folder
  await A.page.goto(`/g/${gid}/vault`);
  for (const [name, access] of [['Insurance', null], ['Bank', 'admins']] as const) {
    await A.page.getByTestId('new-folder').click();
    await A.page.getByTestId('folder-name').fill(name);
    if (access) await A.page.getByRole('tab', { name: 'Admins only' }).click();
    await A.page.getByTestId('folder-save').click();
    await expect(A.page.getByTestId('group-screen-vault')).toContainText(name);
  }
  await A.page.getByText('Insurance').click();
  await A.page.getByTestId('new-doc').click();
  await A.page.getByTestId('doc-title').fill('Dad health insurance');
  await A.page.getByTestId('doc-expires').fill('2027-03-31');
  await A.page.getByTestId('doc-save').click();
  await expect(A.page.getByTestId('folder-screen')).toContainText('31 Mar');
  await B.page.goto(`/g/${gid}/vault`);
  await expect(B.page.getByTestId('group-screen-vault')).toContainText('Insurance');
  await expect(B.page.getByTestId('group-screen-vault')).not.toContainText('Bank');
  await B.page.getByTestId('vault-search').fill('insurance');
  await expect(B.page.getByTestId('vault-results')).toContainText('Dad health insurance');

  // meds
  await A.page.goto(`/g/${gid}/meds`);
  await A.page.getByTestId('new-med').click();
  await A.page.getByTestId('med-patient').fill('Dad');
  await A.page.getByTestId('med-name').fill('Metformin');
  await A.page.getByTestId('med-save').click();
  await expect(A.page.getByTestId('group-screen-meds')).toContainText('Metformin');

  // emergency card + arrived safely
  await B.page.goto(`/g/${gid}/safety`);
  await B.page.getByTestId('card-bloodType').fill('O+');
  await B.page.getByTestId('card-allergies').fill('Penicillin');
  await B.page.getByTestId('card-save').click();
  await B.page.getByTestId('arrived').click();
  await expect(B.page.getByTestId('arrived')).toContainText('told');
  await A.page.goto(`/g/${gid}/safety`);
  await expect(A.page.getByTestId('group-screen-safety')).toContainText('Penicillin');
  await A.page.goto('/inbox');
  await expect(A.page.getByTestId('inbox-screen')).toContainText('arrived safely');

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${gid}/vault`);
  await expect(A.page.getByTestId('group-screen-vault')).toContainText('Bank');
  await shoot(A.page, 'v1.5', 'ar-vault');
  await A.page.goto(`/g/${gid}/meds`);
  await expect(A.page.getByTestId('group-screen-meds')).toContainText('Metformin');
  await shoot(A.page, 'v1.5', 'ar-meds');
  await A.page.goto(`/g/${gid}/safety`);
  await expect(A.page.getByTestId('my-card')).toBeVisible();
  await shoot(A.page, 'v1.5', 'ar-safety');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
