import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

test('meal plan → groceries, memories + book, AI drafts (fake model); Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-family').click();
  await A.page.getByTestId('group-name').fill('Home');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();

  // meals → grocery list
  await A.page.goto(`/g/${gid}/meals`);
  for (const [title, ing] of [['Koshary', '500 g rice\n2 onions'], ['Mahshi', '300 g rice\n1 onions']]) {
    await A.page.getByTestId('new-meal').click();
    await A.page.getByTestId('meal-title').fill(title);
    await A.page.getByTestId('meal-ingredients').fill(ing);
    await A.page.getByTestId('meal-save').click();
    await expect(A.page.getByTestId('group-screen-meals')).toContainText(title);
  }
  await A.page.getByTestId('meals-to-list').click();
  await expect(A.page.getByTestId('meals-to-list-result')).toBeVisible();
  await A.page.getByTestId('meals-open-list').click();
  await expect(A.page.getByTestId('list-detail')).toContainText('rice × 800 g');
  await expect(A.page.getByTestId('list-detail')).toContainText('onions × 3');

  // memories
  await A.page.goto(`/g/${gid}/memories`);
  await A.page.getByTestId('new-memory').click();
  await A.page.getByTestId('memory-text').fill('Friday lunch at grandma’s 🥘');
  await A.page.getByTestId('memory-save').click();
  await expect(A.page.locator('[data-testid^="memory-"]').first()).toContainText('grandma');
  const book = await (await A.page.request.get(`/api/groups/${gid}/memories/book?year=${new Date().getFullYear()}&lang=ar`)).json();
  expect(book.html).toContain('dir="rtl"');
  expect(book.count).toBe(1);

  // AI smart capture (fake model) fills a draft; nothing is saved until Save
  await A.page.goto('/capture');
  await A.page.getByTestId('capture-input').fill('Remind Bassem to pay internet tomorrow 9pm');
  await A.page.getByTestId('capture-smart').click();
  await expect(A.page.getByTestId('capture-draft')).toContainText('pay internet');
  expect((await (await A.page.request.get(`/api/groups/${gid}/tasks`)).json()).some((x: any) => /internet/i.test(x.title))).toBe(false);
  await A.page.getByTestId('capture-save').click();
  await expect.poll(async () => (await (await A.page.request.get(`/api/groups/${gid}/tasks`)).json()).find((x: any) => /internet/i.test(x.title))?.assigneeId).toBeTruthy();

  // "what did I miss" + suggestions from chat
  await B.page.request.post(`/api/groups/${gid}/messages`, { data: { body: "Let's play football tomorrow 9pm?" } });
  await A.page.goto(`/g/${gid}/chat`);
  await A.page.getByTestId('ai-suggest').click();
  await expect(A.page.getByTestId('ai-sheet')).toContainText('play football');
  await A.page.getByTestId('ai-add-0').click();
  await expect(A.page.getByTestId('ai-add-0')).toContainText('Added');

  // Arabic screens
  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${gid}/meals`);
  await expect(A.page.getByTestId('group-screen-meals')).toContainText('Koshary');
  await shoot(A.page, 'v1.4', 'ar-meals');
  await A.page.goto(`/g/${gid}/memories`);
  await expect(A.page.locator('[data-testid^="memory-"]').first()).toBeVisible();
  await shoot(A.page, 'v1.4', 'ar-memories');
  await A.page.goto('/capture');
  await A.page.getByTestId('capture-input').fill('اجتماع العيلة بكرة الساعة ٨ م');
  await A.page.getByTestId('capture-smart').click();
  await expect(A.page.getByTestId('capture-draft')).toBeVisible();
  await shoot(A.page, 'v1.4', 'ar-capture-ai');
  expect(A.errors).toEqual([]);
});
