import { expect, test } from '@playwright/test';
import { newUser, setLanguage, shoot } from './helpers';

test('sport pack: teams, carpool; study pack: focus room presence, flashcards, wiki; Arabic', async ({ browser }) => {
  const A = await newUser(browser, 'Amal');
  const B = await newUser(browser, 'Bassem');
  // Sport
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-sport').click();
  await A.page.getByTestId('group-name').fill('Thursday Football');
  await A.page.getByTestId('create-group').click();
  const code = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const sportId = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${code}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();
  const ev = await (await A.page.request.post(`/api/groups/${sportId}/events`, { data: { title: 'Friday 5-a-side', startsAt: new Date(Date.now() + 86_400_000).toISOString() } })).json();
  await A.page.request.post(`/api/groups/${sportId}/events/${ev.id}/rsvp`, { data: { status: 'going' } });
  await B.page.request.post(`/api/groups/${sportId}/events/${ev.id}/rsvp`, { data: { status: 'going' } });
  await A.page.goto(`/g/${sportId}/event/${ev.id}`);
  await A.page.getByTestId('balance-teams').click();
  await expect(A.page.getByTestId('teams-result')).toContainText('Bassem');
  await expect(A.page.getByTestId('motm')).toContainText('kick-off');
  await A.page.getByTestId('offer-seats').click();
  await A.page.getByRole('button', { name: 'Save' }).click();
  await B.page.goto(`/g/${sportId}/event/${ev.id}`);
  await B.page.locator('[data-testid^="take-seat-"]').click();
  await expect(B.page.locator('[data-testid^="car-"]')).toContainText('1/3');
  await A.page.goto(`/g/${sportId}/teams`);
  await expect(A.page.getByTestId('leaderboard')).toBeVisible();

  // Study
  await A.page.goto('/new-group');
  await A.page.getByTestId('template-study').click();
  await A.page.getByTestId('group-name').fill('Masters');
  await A.page.getByTestId('create-group').click();
  const studyCode = (await A.page.getByTestId('invite-code').textContent())!.trim();
  await A.page.getByTestId('invite-done').click();
  const studyId = new URL(A.page.url()).pathname.split('/')[2];
  await B.page.goto(`/join/${studyCode}`);
  await B.page.getByTestId('join-submit').click();
  await expect(B.page.getByTestId('group-screen-home')).toBeVisible();
  // focus room: B sees A appear live
  await B.page.goto(`/g/${studyId}/focus`);
  await A.page.goto(`/g/${studyId}/focus`);
  await A.page.getByTestId('focus-start').click();
  await expect(B.page.getByTestId('focus-room')).toContainText('🟢');
  await expect(A.page.getByTestId('focus-stop')).toBeVisible();
  // flashcards
  await A.page.goto(`/g/${studyId}/flashcards`);
  await A.page.getByTestId('new-deck').click();
  await A.page.getByTestId('deck-title').fill('Linear algebra');
  await A.page.getByTestId('deck-save').click();
  await A.page.getByTestId('card-front').fill('det(I) = ?');
  await A.page.getByTestId('card-back').fill('1');
  await A.page.getByTestId('card-save').click();
  await A.page.getByTestId('study-start').click();
  await A.page.getByTestId('study-show').click();
  await expect(A.page.getByTestId('study-answer')).toHaveText('1');
  await A.page.getByTestId('grade-good').click();
  await expect(A.page.getByTestId('study-done')).toBeVisible();
  // wiki
  await A.page.goto(`/g/${studyId}/notes`);
  await A.page.getByTestId('new-page').click();
  await A.page.getByTestId('page-title').fill('Exam tips');
  await A.page.getByTestId('page-body').fill('Sleep well. Past papers.');
  await A.page.getByTestId('page-save').click();
  await expect(A.page.getByTestId('page-screen')).toContainText('Past papers');

  // Arabic
  await A.page.request.post(`/api/groups/${studyId}/countdowns`, { data: { title: 'الامتحانات النهائية', at: new Date(Date.now() + 23 * 86_400_000).toISOString() } });
  await setLanguage(A.page, 'ar');
  await A.page.goto(`/g/${studyId}/focus`);
  await expect(A.page.getByTestId('pomodoro')).toBeVisible();
  await shoot(A.page, 'v1.3', 'ar-focus');
  await A.page.goto(`/g/${studyId}`);
  await expect(A.page.getByTestId('home-countdown')).toBeVisible();
  await shoot(A.page, 'v1.3', 'ar-study-home');
  await A.page.goto(`/g/${studyId}/flashcards`);
  await expect(A.page.locator('[data-testid^="deck-"]')).toBeVisible();
  await shoot(A.page, 'v1.3', 'ar-flashcards');
  await A.page.goto(`/g/${sportId}/event/${ev.id}`);
  await expect(A.page.getByTestId('motm')).toBeVisible();
  await shoot(A.page, 'v1.3', 'ar-event-sport');
  await A.page.goto(`/g/${sportId}/teams`);
  await expect(A.page.getByTestId('leaderboard')).toContainText('Bassem');
  await shoot(A.page, 'v1.3', 'ar-teams');
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
