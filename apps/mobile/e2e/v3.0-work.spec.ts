import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

test('work team: board, stand-up, meeting notes → tasks, leave calendar; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-work').click();
  await A.page.getByTestId('group-name').fill('Product team');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const gid = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();
  const bId = (await (await B.page.request.get('/api/me')).json()).id;
  const task = await (await A.page.request.post(`/api/groups/${gid}/tasks`, { data: { title: 'Fix the login bug', assigneeId: bId } })).json();

  // board: Bassem starts and finishes his task
  await B.page.goto(`/g/${gid}/tasks`);
  await B.page.getByTestId('open-board').click();
  await expect(B.page.getByTestId('board-todo')).toContainText('Fix the login bug');
  await B.page.getByTestId(`start-${task.id}`).click();
  await expect(B.page.getByTestId('board-doing')).toContainText('Fix the login bug');
  await B.page.getByTestId(`finish-${task.id}`).click();
  await expect(B.page.getByTestId('board-done')).toContainText('Fix the login bug');

  // stand-up
  await B.page.goto(`/g/${gid}/standups`);
  await B.page.getByTestId('standup-yesterday').fill('Fixed the login bug');
  await B.page.getByTestId('standup-today').fill('Start the invoices screen');
  await B.page.getByTestId('standup-blockers').fill('Need the API key');
  await B.page.getByTestId('standup-post').click();
  await expect(B.page.getByTestId('standup-me')).toContainText('Start the invoices screen');
  await A.page.goto(`/g/${gid}/standups`);
  await expect(A.page.getByTestId(`standup-${bId}`)).toContainText('Need the API key');
  await expect(A.page.getByTestId('standup-form')).toBeVisible();

  // meeting notes → tasks
  await A.page.goto(`/g/${gid}/meetings`);
  await A.page.getByTestId('new-meeting').click();
  await A.page.getByTestId('meeting-title').fill('Weekly sync');
  await A.page.getByTestId('meeting-notes').fill('Revenue is up\n- [ ] Send the deck to the client @Bassem\nTODO: update the roadmap');
  await A.page.getByTestId('meeting-save').click();
  await expect(A.page.locator('[data-testid^="meeting-"]').first()).toContainText('☐ Send the deck to the client · Bassem');
  await A.page.locator('[data-testid^="make-tasks-"]').click();
  await expect(A.page.locator('[data-testid^="meeting-"]').first()).toContainText('✅ Send the deck to the client');
  await B.page.goto(`/g/${gid}/tasks`);
  await expect(B.page.getByTestId('group-screen-tasks')).toContainText('Send the deck to the client');

  // leave calendar: Bassem is off today
  await B.page.goto(`/g/${gid}/leave`);
  await B.page.getByTestId('new-leave').click();
  await B.page.getByTestId('leave-save').click();
  await A.page.goto(`/g/${gid}/leave`);
  await expect(A.page.getByTestId('group-screen-leave')).toContainText('Bassem');

  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${gid}/board`);
  await expect(A.page.getByTestId('board-done')).toContainText('Fix the login bug');
  await shoot(A.page, 'v3.0', 'ar-board');
  await A.page.goto(`/g/${gid}/standups`);
  await expect(A.page.getByTestId(`standup-${bId}`)).toBeVisible();
  await shoot(A.page, 'v3.0', 'ar-standups');
  await A.page.goto(`/g/${gid}/meetings`);
  await expect(A.page.locator('[data-testid^="meeting-"]').first()).toBeVisible();
  await shoot(A.page, 'v3.0', 'ar-meetings');
  await A.page.goto(`/g/${gid}/leave`);
  await expect(A.page.getByTestId('group-screen-leave')).toContainText('Bassem');
  await shoot(A.page, 'v3.0', 'ar-leave');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
