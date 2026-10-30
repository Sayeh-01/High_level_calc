import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

// B9 v1.0 #8: A creates a Sport group → shares the code → B joins → A creates a match → B RSVPs →
// A splits the cost among Going → B's Today shows what B owes. Then #9: Arabic screenshots.
test('sport group end to end, then Arabic mirroring', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');

  // A creates a Sport group
  await A.page.getByTestId('tab-groups').click();
  await A.page.getByTestId('new-group').click();
  await A.page.getByTestId('template-sport').click();
  await A.page.getByTestId('group-name').fill('Thursday Football');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await A.page.getByTestId('invite-done').click();
  await expect(A.page.getByTestId('group-screen-home')).toBeVisible();
  const groupId = new URL(A.page.url()).pathname.split('/')[2];

  // B joins with the code (same screen a circleapp://join/CODE deep link opens)
  await B.page.goto(`/join/${code}`);
  await expect(B.page.getByTestId('join-preview')).toContainText('Thursday Football');
  await expect(B.page.getByTestId('join-preview')).toContainText('Amal');
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();

  // A creates a match for tomorrow
  await A.page.getByTestId('tab-events').click();
  await A.page.getByTestId('new-event').click();
  await A.page.getByTestId('event-title').fill('Friday 5-a-side');
  await A.page.getByTestId('event-when-day-1').click();
  await A.page.getByTestId('event-save').click();
  await expect(A.page.getByTestId('event-detail')).toBeVisible();
  await expect(A.page.getByTestId('event-spots')).toContainText('0/12');
  const eventPath = new URL(A.page.url()).pathname;
  await A.page.getByTestId('rsvp-going').click();
  await expect(A.page.getByTestId('event-spots')).toContainText('1/12');

  // B RSVPs
  await B.page.goto(eventPath);
  await B.page.getByTestId('rsvp-going').click();
  await expect(B.page.getByTestId('event-spots')).toContainText('2/12');

  // A splits 100 EGP among Going
  await A.page.reload();
  await expect(A.page.getByTestId('event-spots')).toContainText('2/12');
  await A.page.getByTestId('split-cost').click();
  await A.page.getByTestId('split-amount').fill('100');
  await A.page.getByTestId('split-save').click();
  await expect(A.page.getByTestId('group-screen-expenses')).toBeVisible();
  await expect(A.page.getByTestId('balances-card')).toContainText('50');

  // B's Today shows what B owes
  await B.page.goto('/');
  const money = B.page.getByTestId(`today-money-${groupId}`);
  await expect(money).toContainText('Amal');
  await expect(money).toContainText('50');

  // B9 #9: Arabic mirrors Today, Group home, Tasks, Expenses, Event
  await setLanguage(B.page, 'ar');
  await B.page.goto('/');
  await expect(B.page.getByTestId(`today-money-${groupId}`)).toContainText('عليك');
  await shoot(B.page, 'v1.0', 'ar-today');
  await B.page.goto(`/g/${groupId}`);
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();
  await shoot(B.page, 'v1.0', 'ar-group-home');
  await B.page.goto(`/g/${groupId}/tasks`);
  await expect(B.page.getByTestId('group-screen-tasks')).toBeVisible();
  await shoot(B.page, 'v1.0', 'ar-tasks');
  await B.page.goto(`/g/${groupId}/expenses`);
  await expect(B.page.getByTestId('balances-card')).toBeVisible();
  await shoot(B.page, 'v1.0', 'ar-expenses');
  await B.page.goto(eventPath);
  await expect(B.page.getByTestId('event-detail')).toBeVisible();
  await shoot(B.page, 'v1.0', 'ar-event');
  // digits switch to Arabic-Indic
  await B.page.goto('/me');
  await B.page.getByTestId('me-digits-arab').click();
  await B.page.goto(eventPath);
  await expect(B.page.getByTestId('event-spots')).toContainText('٢');
  await shoot(B.page, 'v1.0', 'ar-event-arabic-digits');

  // English reference shot
  await shoot(A.page, 'v1.0', 'en-expenses');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});

test('tasks, lists, polls, chat and quick capture on web', async ({ browser }) => {
  const A = await newUser(browser, 'Karim');
  await A.page.getByTestId('tab-groups').click();
  await A.page.getByTestId('new-group').click();
  await A.page.getByTestId('template-family').click();
  await A.page.getByTestId('group-name').fill('Home');
  await A.page.getByTestId('create-group').click();
  await A.page.getByTestId('invite-done').click();
  const groupId = new URL(A.page.url()).pathname.split('/')[2];

  // starter chore exists; create a task
  await A.page.getByTestId('tab-tasks').click();
  await expect(A.page.getByTestId('group-screen-tasks').getByText('Take out the trash')).toBeVisible();
  await A.page.getByTestId('new-task').click();
  await A.page.getByTestId('task-title').fill('Buy gas cylinder');
  await A.page.getByTestId('task-save').click();
  await expect(A.page.getByTestId('group-screen-tasks').getByText('Buy gas cylinder')).toBeVisible();

  // list: starter Groceries, add an item
  await A.page.getByTestId('tab-lists').click();
  await A.page.getByTestId('group-screen-lists').getByText('Groceries').click();
  await A.page.getByTestId('item-title').fill('Eggs');
  await A.page.getByTestId('item-add').click();
  await expect(A.page.getByTestId('list-detail').getByText('Eggs')).toBeVisible();

  // poll
  await A.page.goto(`/g/${groupId}/polls`);
  await A.page.getByTestId('new-poll').click();
  await A.page.getByTestId('poll-question').fill('Dinner?');
  await A.page.getByTestId('poll-opt-0').fill('Koshary');
  await A.page.getByTestId('poll-opt-1').fill('Molokhia');
  await A.page.getByTestId('poll-save').click();
  await A.page.getByTestId('group-screen-polls').getByText('Koshary').click();
  await expect(A.page.getByTestId('group-screen-polls').getByText('1 vote', { exact: true })).toBeVisible();

  // chat announcement
  await A.page.goto(`/g/${groupId}/chat`);
  await A.page.getByTestId('chat-input').fill('Friday lunch at grandma');
  await A.page.getByTestId('chat-announce').click();
  await expect(A.page.getByTestId('pinned-banner')).toContainText('Friday lunch');

  // quick capture with a parsed date
  await A.page.goto('/capture');
  await A.page.getByTestId('capture-input').fill('Pay internet tomorrow 9pm');
  await A.page.getByTestId(`capture-group-${groupId}`).click();
  await A.page.getByTestId('capture-save').click();
  await A.page.goto(`/g/${groupId}/tasks`);
  await expect(A.page.getByTestId('group-screen-tasks').getByText('Pay internet')).toBeVisible();
  await shoot(A.page, 'v1.0', 'en-tasks');
  expect(A.errors).toEqual([]);
});
