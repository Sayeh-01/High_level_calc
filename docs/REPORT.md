# Circle — build report

Evidence for every version (B12), the owner's checklist, and how to run it. Status lives in `docs/PROGRESS.md`.
Nothing here has been run on a phone: everything was verified on the Expo **web** build and in tests (B4/B5 rule 5).

## Where the code is (read this first)

The project lives in **`Sayeh-01/Circle`**, branch **`claude/circle-mobile-app-zm3gcj`**, which starts from Circle's `main`
commit `1d6fcc4` ("Create SPEC.md"). Merging the pull request into `main` puts the whole project on `main`.

(It was built in a session attached to `Sayeh-01/High_level_calc`, where the same branch also exists — with a `main` made
from the same spec commit — because pushing to Circle wasn't allowed at first. Circle is the home from now on.)

## How to run it locally

```bash
corepack enable            # pnpm 10
pnpm install
pnpm check                 # typecheck → Vitest (shared + server on PGlite) → Playwright on the Expo web build
pnpm dev:server            # API + jobs + realtime on :4100, in-memory PGlite; OTP codes print to the console
pnpm dev:mobile            # Expo; for a phone set EXPO_PUBLIC_API_URL=http://<LAN-IP>:4100
docker compose up          # real Postgres 17 + server (Docker was not available in this container)
```

Useful env vars (server): `DATABASE_URL` (real Postgres; PGlite when unset), `PGLITE_DIR` (persist PGlite to disk),
`PUBLIC_URL`, `BETTER_AUTH_SECRET`, `SMTP_URL` + `MAIL_FROM`, `EXPO_ACCESS_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`,
`APPLE_CLIENT_ID/SECRET`, `ANTHROPIC_API_KEY`, `LINK_DOMAIN`, `FILES_DIR`, `STATIC_DIR`, `JOBS=0` (disable job loop).

## Owner's device checklist

Make a development build first (Expo Go can't do remote push on Android, B7 #6):
`npx eas-cli@latest build --profile development --platform ios|android` (needs the accounts below), install it, run
`pnpm dev:server` on your machine and start the app with `EXPO_PUBLIC_API_URL=http://<LAN-IP>:4100 pnpm dev:mobile`.

1. **Login persistence (B7 #7):** sign in with email + code, force-quit, reopen → still signed in, Today loads.
2. **Push:** allow notifications; from a second account assign yourself a task → banner arrives; check the
   "✓ Done" / "I'm in" / "Confirm" action buttons appear (categories `task`, `rsvp`, `settle`).
3. **Deep links:** open `circleapp://join/<CODE>` (e.g. from Notes) → join preview opens. Universal links need the domain (below).
4. **Camera / photos:** complete a task with photo proof; send a photo in chat; change profile and group photo.
5. **RTL:** Me → Language → العربية → the app asks to close and reopen; after reopening, tabs, chevrons, swipes and
   lists must run right-to-left. Switch back to English the same way.
6. **Arabic digits:** Me → Digits → Arabic (١٢٣) → amounts, dates and counts use Arabic-Indic digits.
7. **Haptics:** completing a task gives a success tap.
8. **Offline reads:** load Today, enable airplane mode, force-quit, reopen → cached Today still shows.
9. **Time zone:** set the phone to another zone; a group's weekly 21:00 match should still show 21:00 group time.
10. **QR invite:** scan the QR on the invite screen with the phone camera → opens the join link (needs the domain for https links).

11. **v1.1 universal links (after the domain is set):** tap `https://<domain>/join/<CODE>` and `https://<domain>/p/<token>` in
    WhatsApp → the app opens (not the browser). Verify Apple's CDN fetched `/.well-known/apple-app-site-association`.
12. **v1.1 phone OTP:** with a real SMS driver, sign in with an Egyptian number; the code arrives by SMS.
13. **v1.1 Google/Apple sign-in:** with client ids set, the buttons appear and complete the round trip back into the app.
14. **v1.1 WhatsApp share card:** share a match from the event screen → WhatsApp shows the title/description preview
    (needs the public domain; WhatsApp can't fetch localhost).
15. **v1.1 calendar feed:** add the ICS URL to Google Calendar and Apple Calendar; events appear and update.

16. **v1.2 voice notes:** in a group chat tap 🎙️, allow the microphone, record ~5 s, tap ⏹ → the note uploads and plays
    on another phone and on the web build (web only plays). Check iOS silent mode playback.
17. **v1.2 Kids mode on a shared phone:** Me → Kids on this device → tap the child → PIN → the app shows Kids home;
    force-quit and reopen → still the child's session; the "+" tab is hidden; Expenses can't be opened.
18. **v1.2 haptics:** completing a chore in Kids home gives a success tap.

19. **v1.3 focus room:** two phones open the same study group's Focus tab; one taps Start → the other sees 🟢 within a
    second; backgrounding the app for a while and returning reconnects (the socket reconnects on foreground).

20. **v1.4 yearly book PDF:** Memories → 📖 Yearly book → a PDF opens in the share sheet; Arabic text is joined correctly
    (not disconnected letters) and photos appear.
21. **v1.4 live AI (with `ANTHROPIC_API_KEY`):** Add → ✨ Smart capture with "remind the roommates to pay internet Friday"
    → the form fills with the right group, assignee and Friday; nothing is created until Save.

22. **v1.5 vault photos:** add a document with a photo from the camera roll; it opens for a member with folder access; a
    member without access doesn't see the folder at all.
23. **v1.5 med reminders:** add a med at a time 2 minutes from now → the push arrives at that local time with "💊 …";
    tap "Given" → the dose shows who gave it.
24. **v1.5 "arrived safely" / SOS:** both send a push to the other members; check SOS isn't silenced by quiet mode (iOS
    critical alerts need an Apple entitlement — owner decision).
25. **v1.5 emergency card on the lock screen:** needs a widget/Live Activity (native extension) — not built (widgets are a B5 Skip).

26. **v2.0 receipt scan (with `ANTHROPIC_API_KEY`):** Expenses → 📷 Scan receipt → take/choose a real receipt photo → the
    sheet fills with the shop, total and currency; nothing is saved until Save.
27. **v2.0 guest invite:** Guest list → Send invite opens WhatsApp with the guest's link; the guest opens it on a phone
    without the app, picks plus-ones and taps Going → the host's headcount updates live.
28. **v2.0 contacts:** the 📞 Call button opens the phone dialer with the number.

29. **v2.2 gam'eya reminders:** start a round with a due day of tomorrow → at 09:00 the members who haven't paid get
    "💰 … due tomorrow" and the receiver gets "You receive the pot this month"; tapping opens the board.

30. **v2.4 paywall:** Me → ✨ Circle Plus and a full group's Invite → Upgrade open the paywall; prices show in EGP and USD;
    "Upgrade" says purchases aren't connected yet. After RevenueCat is set up (accounts row 10), buy each plan with a sandbox
    account and check the plan turns on (server webhook still to build then).

31. **v2.6 pay online (after a real gateway is added):** Pay online from a due → the gateway page opens in the browser →
    pay with a sandbox card → coming back to the app shows "Paid ✓" and the receipt opens as a PDF in the share sheet.
    With the fake gateway in a dev build: the browser opens the fake checkout; return to the app manually.

32. **v2.8 signature pad:** sign a form with a finger on iPhone and Android: the stroke follows the finger smoothly, the screen
    doesn't scroll while signing, and the signature looks the same on another phone and on the printed sheet (PDF).
33. **v2.8 Hijri date:** the Faith group's Challenges screen shows today's Hijri date matching a local calendar.

34. **v3.0 stand-up push:** in a Work Team on a work day, the 09:30 reminder arrives for those who haven't answered and the
    12:00 summary appears in the group chat as "🤖 Circle".

35. **v3.2 checklist photo proof:** tick a 📷 item on a phone → the camera roll opens, the photo uploads and shows under the item
    with the time; a manager sees it in history.

36. **v3.4 QR clock-in:** a manager opens Time clock; a staff phone's camera scans the QR → the app opens on the clock screen with
    the code filled in → Clock in. Wait over a minute and try an old screenshot of the QR → "code expired".
37. **v3.4 geofence clock-in:** not built (B5 Skip — device only).

38. **v3.6 low-stock push:** use stock down to its threshold on one phone → the manager's phone gets one "📦 Low stock" push;
    using more doesn't send another until it's restocked above the threshold.

(Later versions add their own device checks in their sections below.)

## Accounts and keys needed (priority order)

| # | Account | What it unlocks | Env var(s) |
|---|---|---|---|
| 1 | Apple Developer + Google Play Console + Expo (EAS) | Dev/store builds, real push, all device checks | `EXPO_ACCESS_TOKEN` (server push), EAS project id in `app.json` → `extra.eas.projectId` |
| 2 | SMTP provider (e.g. Resend) | Real sign-in emails | `SMTP_URL`, `MAIL_FROM` |
| 3 | A domain | Universal links, hosted guest pages | `LINK_DOMAIN`, `PUBLIC_URL`; update `associatedDomains` / `intentFilters` in `apps/mobile/app.json` |
| 4 | Managed Postgres (e.g. Neon) + a VPS/Fly.io + Cloudflare R2 | Production | `DATABASE_URL`, storage keys (R2 driver to add) |

| 5 | SMS provider (Twilio / Vonage / an Egyptian gateway) | Real phone OTP (v1.1) | add a driver in `apps/server/src/sms.ts` + its keys |
| 6 | Google OAuth client (Web + iOS + Android) | Google sign-in (v1.1) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 7 | Apple "Sign in with Apple" service id + key (required once Google is offered) | Apple sign-in (v1.1) | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` |

| 8 | Anthropic API key | Live AI (v1.4 quick capture, chat → items, "what did I miss", quiz from notes; later the assistant) | `ANTHROPIC_API_KEY` (server only; never in the app) |

| 9 | A strong `DATA_KEY` secret | Encryption key for vault files, notes, OCR text, emergency cards, med notes (v1.5) | `DATA_KEY` (keep it backed up — losing it loses the encrypted data) |

| 10 | RevenueCat + App Store Connect / Google Play products (`plus`, `group_pro`, monthly) | Real in-app purchases (v2.4) | RevenueCat public SDK keys in the app, a webhook secret on the server — the webhook route and `react-native-purchases` adapter are the next step; until then grant plans with `pnpm --filter @circle/server grant` |

| 11 | Payment gateway account (Egypt: Paymob or Fawry; elsewhere Stripe) + the regulatory check A12 asks for | Real online payments (v2.6) | gateway keys + webhook secret; implement `PaymentProvider` (`apps/server/src/payments/provider.ts`) — create checkout + verify webhook — and set it in `createApp`. `FEE_BPS`, `FEE_FIXED_MINOR` set the fee |


## Defects or contradictions found in the brief

1. **pg-boss vs. "the whole suite runs on PGlite"** (B3 vs B1/B3): pg-boss needs a TCP Postgres connection. Took the
   simpler reading: our own Postgres `jobs` table with the same semantics (absolute `run_at`, retries, dead letters).
2. **Account deletion heir** (B9 #10) only covers "oldest Admin" and "nobody else". Groups with members but no admin pass
   to the oldest Manager, then the oldest Member.
3. **Expo SDK:** the brief says 56+; the current SDK is 58, used as-is.
4. **"Push: settle-up awaiting my confirmation"** etc. are listed, but the brief has no notification preferences UI in
   v1.0; quiet hours/digests are A9 features without a version — not built.

## Open questions for the owner

1. Should a group with members but no admin really pass to a regular member when the owner deletes their account?
2. Default currency per group is EGP; should templates or the user's locale pick it?
3. Members can invite by default. Keep that, or make invites admin-only by default?
4. (v2.4) Only the member cap is enforced. Should Plus / Group Pro features (AI, vault alerts, dues, exports) be gated too?
   It's one check per feature (`activePlans`), but A16 says to validate prices first, and gating would change existing groups.
5. (v2.2) Gam'eya allows one share per member. Do you need half / double shares ("سهمين")?

---

## v1.0 MVP — [x] done

**Built:** Email OTP sign-in (Better Auth), profile (name, photo, language, digits, timezone), delete account, export;
groups from 6 templates (modules, renamed roles, vocabulary, starter content, defaults), edit name/emoji/photo, module
switches, roles, invites (code, QR, share sheet, WhatsApp), join by code or deep link, leave/remove/transfer, per-group
display name; Today (tasks overdue/today/7 days, events with RSVP, owe/owed, settle-ups to confirm, unread
announcements, inline actions); tasks/chores (assignee or rotation, due, RRULE recurrence, points, photo proof,
comments); calendar (recurrence materialized in the group timezone, location, RSVP, capacity + waitlist with
auto-promotion, reminders, agenda + month); lists (real-time check, qty, who checked); expenses (equal/exact/shares,
balances, simplified debts, settle-up counts only after receiver confirms, reversal, split event among Going); polls
(single/multi, anonymous, deadline); chat (text, image, reply, @mention, pinned announcements, read state); activity
feed (same transaction); push pipeline; realtime invalidation over WebSocket; English + Arabic with RTL and digit choice;
rule-based quick capture.

**Faked:** sending push goes through `createExpoPushSender` (real Expo HTTP API) but only in production/`EXPO_PUSH=1`;
dev and tests use an in-memory sender. Unit-tested with mocked fetch.

**Skipped:** nothing.

**`pnpm check`** (2026-10-30):
```
packages/shared  Test Files  3 passed (3)   Tests  20 passed (20)
apps/server      Test Files  8 passed (8)   Tests  60 passed (60)
apps/mobile      ✓ sport group end to end, then Arabic mirroring (25.7s)
                 ✓ tasks, lists, polls, chat and quick capture on web (13.0s)
                 2 passed (44.3s)
```

| B9 v1.0 check | Evidence |
|---|---|
| 1 100.00 / 3 = 33.34/33.33/33.33; splits sum exactly | `packages/shared/test/money.test.ts` "splits (B9 v1.0 #1)" (500 random cases per kind) |
| 2 A pays 300 → B, C owe 100; confirmed settlement clears B; unconfirmed changes nothing | `money.test.ts` "balances (B9 v1.0 #2)" + API version in `apps/server/test/money.test.ts` |
| 3 simplify debts ≤ n−1 transfers, keeps balances | `money.test.ts` "simplify debts (B9 v1.0 #3)" (300 random ledgers) |
| 4 rotation A→B→C→A skipping away | `packages/shared/test/rotation.test.ts`; on completion via API in `apps/server/test/items.test.ts` |
| 5 weekly 21:00 Cairo stays 21:00 across DST | `packages/shared/test/recurrence.test.ts` (spring and autumn 2026; asserts UTC hour really changes) |
| 6 Member can't change modules (403); only Owner deletes | `apps/server/test/groups.test.ts` "B9 #6" |
| 7 13th RSVP waitlisted; #5 cancels → promoted; concurrent last spot → exactly one | `apps/server/test/events.test.ts` (plus 15 concurrent RSVPs on 5 spots) |
| 8 Sport group → code → join → match → RSVP → split → B's Today owes | `apps/mobile/e2e/v1.0-mvp.spec.ts` test 1 |
| 9 Arabic mirrors Today, Group home, Tasks, Expenses, Event | `apps/mobile/e2e/screenshots/v1.0/ar-*.png`; `shoot()` fails the test on clipped/off-screen text |
| 10 Delete account: profile + memberships gone; groups to oldest Admin or deleted | `apps/server/test/account.test.ts` |
| 11 Push in chunks ≤ 100, prunes invalid tokens | `apps/server/test/push.test.ts` (mocked fetch; tickets + receipts; retry/backoff/dead) |

**Global gates:** route sweep — `apps/server/test/sweep.test.ts` walks every `/api/groups/:groupId` route registered in
the app (57 routes at v1.0) as a non-member → all 404, and without a session → all 401. Cross-group tests for task,
event, list, list item, expense, settlement, poll, message, file in the same file. Realtime with real sockets:
`apps/server/test/realtime.test.ts`.

**Seen red once (B9):** each new test file had one assertion broken, run, and restored —
money, rotation, recurrence (shared); groups, sweep, events, money, items, account, push, realtime (server): all went
red (`1 failed`) and green again after revert. The E2E spec failed for real on its first runs (stale cache after reload,
WebSocket route registered after the catch-all) before the fixes.

**Arabic screenshots reviewed by eye:** headers, tab order, chevrons, cards and money rows mirror; one defect found and
fixed — Arabic plural forms (`_two`, `_few`, …) were missing, so "2 members" fell back to English.

**Device checks:** items 1–10 of the owner's checklist.

## v1.1 Reach — [x] done

**Built:** guest links for one event or one list (token-scoped JSON API under `/api/guest/:token/...` + server-rendered,
Arabic/English pages at `/p/:token` with Open Graph tags; guests RSVP with just a name, capacity/waitlist apply; install
prompt from the third visit), guest-link management (reuse, list, revoke), WhatsApp share from an event (card text +
guest link), list sharing, ICS feed per user (`/ics/<token>.ics`, rotate to revoke; folded/escaped RFC 5545), universal-link
files (`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`) from the placeholder `LINK_DOMAIN`, app
config for associated domains/intent filters, `circleapp://p/<token>` opens the item for members.

**Faked:** phone OTP (Better Auth phone-number plugin → `SmsSender` dev driver that logs codes; test-only `/api/test/sms`);
Google and Apple sign-in wired from env vars (buttons hidden when unset; tested that Better Auth returns the Google
authorize URL with a fake client id).

**Skipped:** domain verification (needs a domain).

**`pnpm check`:** shared 20/20 · server 71/71 (9 files) · E2E 5/5 (`v1.0-mvp.spec.ts`, `v1.1-reach.spec.ts`).

| B9 v1.1 check | Evidence |
|---|---|
| A guest link page lets a non-user RSVP and it shows in the app | `apps/server/test/reach.test.ts` (form post + JSON, waitlist + promotion for guests); E2E `v1.1-reach.spec.ts` — guest RSVPs in a cookie-less browser and A's open event screen shows "Mostafa (guest)" via realtime, no reload |
| The token only opens its own item (other id → 404) | `reach.test.ts` "the token only opens its own item" (other event, other list, list token on event route, other group's item) |
| A revoked token stops working | `reach.test.ts` "a revoked token stops working" (API + HTML page) |
| ICS parses and contains only that user's events | `reach.test.ts` "ICS feed" — in-test RFC 5545 reader (CRLF, ≤75-octet folding, escaping), excludes other groups' and declined events |

**Global gates:** route sweep now covers 60 group routes (new `guest-links` routes included automatically); cross-group test for
guest links (`reach.test.ts`). Arabic screenshots: `apps/mobile/e2e/screenshots/v1.1/` (guest page, Me with calendar feed,
group settings with guest links, phone sign-in) — reviewed by eye; fixed a web-only RTL defect (switch thumb drawn outside
its track). Seen red: `reach.test.ts` (broken assertion → 1 failed → restored); `v1.1-reach.spec.ts` failed for real first
(the creator's open socket didn't subscribe to a group it had just created — fixed + real-socket test added).

**Device checks:** owner checklist items 11–15.

## v1.2 Motivation — [x] done

**Built:** points ledger (chore points on completion; balance = sum of ledger, never stored), rewards shop (approvers add
rewards; members redeem; fulfil / cancel-with-refund), streaks per member in the group timezone, fairness meter (this
month's chore points as integer % that sum to exactly 100), hand adjustments, Child accounts (created by a parent, no email,
PIN sign-in through a Better Auth plugin endpoint, scrypt-hashed PIN, 5 wrong tries → 15-minute lock, parent can reset/
delete), Kids mode (big chore buttons, points, shop; "+" tab hidden), parent approval of a Child's chores before points,
Child restrictions (no money via the permission matrix, can't create tasks/groups, can't preview or join other groups,
can't make guest links, can't delete their account), voice notes (recorded with `expo-audio` on device, uploaded as
`audio/*` files; web shows the browser's audio player and hides the record button). Points module added to the Family
template.

**Faked:** nothing. **Skipped:** nothing.

**`pnpm check`:** shared 23/23 (4 files) · server 80/80 (10 files) · E2E 6/6.

| B9 v1.2 check | Evidence |
|---|---|
| Two concurrent reward redemptions can't take points below 0 | `apps/server/test/motivation.test.ts` — 2 concurrent redemptions of a 7-pt reward with 9 pts → exactly one 200, one 409, balance 2; then 6 concurrent 1-pt redemptions with 2 pts → exactly 2 succeed, balance 0 (member row locked `FOR UPDATE` before reading the balance) |
| A Child gets blocked on every money route (sweep) | `motivation.test.ts` — walks every registered route with `money.read`/`money.write` as a signed-in Child → all 403; Child's Today has no money |
| Fairness meter shares add up to 100% | `packages/shared/test/rotation.test.ts` "fairness meter" + API check in `motivation.test.ts` (25/75) |

**Also tested:** PIN lockout and unlock after 15 min, PIN sign-in refuses adult accounts, chore approval doesn't double-award,
cancel refunds, adjustments can't go negative, voice-note files must be audio from the same group, cross-group 404s for
rewards / redemptions / completions. E2E `v1.2-motivation.spec.ts`: parent creates child + reward + chore → a second
browser ("shared tablet") switches to the child with a wrong then right PIN → Kids home → chore → parent approves →
child sees 30 pts → redeems → child gets 403 on `/balances`.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v1.2/` (Points, Me with kids, Kids home) — reviewed; Arabic plural
forms render ("سلسلة يوم واحد").

**Seen red:** shared `motivation.test.ts` and server `motivation.test.ts` (broken assertions → red → restored). The E2E failed
for real first and found three app bugs (below).

**Bugs found by this version's E2E (fixed):**
1. React Compiler (experimental, on by default in the SDK 58 template) evaluated `kid.id` from an event handler during
   render as a memo dependency → crash when `kid` was null. Turned the compiler off app-wide (`app.json`).
2. `Row` without `onPress` rendered a disabled Pressable whose `aria-disabled` disabled every button inside it (also for
   screen readers). Rows without `onPress` are now plain Views.
3. Kids home only listed dated chores (it used Today's 7-day window); it now lists all of the child's open chores.

**Device checks:** owner checklist items 16–18.

## v1.3 Sport & Study — [x] done

**Built:** Sport pack (module `teams`, on in the Sport template): captain/coach skill ratings 1–10, "make two fair teams"
for the players Going (exact DP balancer, unrated = 5), man-of-the-match vote (opens at kick-off; only players vote, only for
players, not for themselves; one vote per player per match enforced by the primary key), attendance stats and season
leaderboard (MOTM wins, matches played, attendance rate), carpool board (offer seats, take/leave a seat; seat count locked
per car, one car per rider per match). Study pack (modules `focus`, `flashcards`, `notes`, on in the Study template): live
focus room (presence over the WebSocket + focus sessions for minutes today and group/personal streaks), 25/5 Pomodoro,
exam countdowns (also pinned on the group home), flashcard decks with a per-member SM-2 schedule and a study mode
(Again/Hard/Good/Easy), notes/wiki pages (Work and Roommates templates also get `notes`).

**Faked:** nothing. **Skipped:** home-screen widgets (B5 Skip — native widget extensions, owner's list).

**`pnpm check`:** shared 28/28 (6 files) · server 90/90 (11 files) · E2E 7/7.

| B9 v1.3 check | Evidence |
|---|---|
| Team balancer matches a brute-force optimum for 10–16 players | `packages/shared/test/balancer.test.ts` — 42 random squads (6 per size 10…16) compared with an independent bitmask brute force |
| MOTM allows one vote per player per match | `apps/server/test/packs.test.ts` — second vote 409, two concurrent votes from one player → exactly one 200, plus non-player 403, nominee-didn't-play 400, self-vote 400, before kick-off 409 |
| Spaced-repetition intervals are unit-tested | `packages/shared/test/srs.test.ts` (1 → 6 → 15 → 39 days, hard/again, ease floor 1.3); per-member schedules over the API in `packs.test.ts` |
| Focus room presence (join/leave) reaches a second socket client | `apps/server/test/realtime.test.ts` "focus room presence" — real server, two members' sockets + an outsider's: join → the other member receives `users: [a]`; leave → `[]`; closing the socket also leaves; the outsider's join is ignored. E2E: B sees 🟢 when A starts focusing |

**Also tested:** carpool overbooking under 3 concurrent joins (exactly 2 of 2 seats), attendance/leaderboard numbers, focus
minutes and streaks across days, wiki edit/delete rules, cross-group 404 for decks, cards, pages, MOTM and carpool.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v1.3/` (event with sport pack, flashcards, focus room, study home with
countdown, team tools) — reviewed by eye; first run had two blank shots taken before render, fixed by waiting for the
screen.

**Seen red:** `balancer.test.ts`, `srs.test.ts`, `packs.test.ts`, and the new presence test in `realtime.test.ts`.

**Device checks:** owner checklist item 19.

## v1.4 Life + AI — [x] done

**Built:** meal planner (module `meals`, Family template): plan a week by day and slot with ingredients; "add this week's
ingredients to the grocery list" merges the same ingredient + unit (unit aliases incl. Arabic) and merges again into the
list's open lines on re-run. Memories (module `memories`): timeline with photos; yearly book rendered as HTML (photos
embedded as data URIs, RTL in Arabic) and turned into a PDF on the device with `expo-print` + share sheet (browser print on
web). Rule-based quick capture moved to `@circle/shared` (reused by the fake model).

**Faked:** the AI model. `apps/server/src/ai.ts` calls Claude through the official SDK when `ANTHROPIC_API_KEY` is set —
`claude-haiku-5-5` with structured output (`messages.parse` + `zodOutputFormat`, effort `low`) for capture, chat → items and
quiz; `claude-sonnet-5-5` (with the server-side refusal fallback `fallbacks: "default"`) for "what did I miss". Tests use
recorded answers (`createFakeModel`); `AI_FAKE=1` (non-production only) gives the E2E build a deterministic rule-based model.
Without either, AI routes answer 503 and the app hides every AI button.

**Skipped:** nothing in v1.4 (widgets were v1.3's skip).

**`pnpm check`:** shared 33/33 (7 files) · server 97/97 (12 files) · E2E 8/8.

| B9 v1.4 check | Evidence |
|---|---|
| Meal plan → groceries merges the same ingredient and unit | `packages/shared/test/meals.test.ts` (g/grams merge, kg separate, Arabic units) + `apps/server/test/life.test.ts` (list gets "rice 800 g", "rice 1 kg", "onions 3"; re-run updates 4 lines, adds 0). E2E: list shows "rice × 800 g", "onions × 3" |
| AI endpoints only return drafts; nothing is saved until the user confirms | `life.test.ts` "AI endpoints only return drafts" — counts tasks, events, cards, messages, list items before/after capture, chat-items, catchup and quiz: unchanged. E2E: after ✨ Smart capture there is no task until Save |
| With the fake model, quick capture can't target a group the user isn't in | `life.test.ts` — fake answers with another group's id / list / member → draft has `groupId: null`, no assignees, no list; the model's prompt never contained the other group's name or id |

**Also tested:** AI 503 without a model, 403 for Child accounts on all AI routes, invalid model output → 422 (not saved),
chat suggestions that cite a non-existent message are dropped, book HTML escapes user text and excludes other years,
memory photos must belong to the group, cross-group 404s for meals and memories.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v1.4/` (meal plan, memories, quick add with an AI draft from an Arabic
sentence) — reviewed.

**Seen red:** `meals.test.ts`, `life.test.ts`.

**Device checks:** owner checklist items 20–21.

## v1.5 Care & Safety — [x] done

**Built:** Vault (module `vault`): folders with access rules (everyone / admins only / chosen people), documents with
encrypted notes and encrypted files (AES-256-GCM at rest, never served by the generic file route), expiry dates with alerts
at 60 / 30 / 7 days at 09:00 group time (the 60-day alert also creates a "Renew" task), search over titles, notes and the text
inside scans (decrypted in memory, only folders you can open). Emergency card (module `safety`): blood type, allergies,
conditions, medications, doctors, insurance, emergency contact — encrypted, readable by the group, writable by yourself, your
parent or an admin. "I arrived safely" and SOS (one tap, push to everyone else, no tracking). Meds (module `meds`): schedules
with several daily times; one reminder job per dose time in the group's timezone, re-armed day by day; dose log with "given by".
Care Circle template (Coordinator/Carer, Appointments, Care duties with a weekly driving rota). Family template gets `safety`.

**Faked:** vault text search inside images — OCR runs through the AI module (`readImage`, Claude Haiku 5.5 when a key is set;
recorded answer in tests; demo text under `AI_FAKE=1`).

**Skipped:** nothing (lock-screen access to the emergency card needs a widget — widgets are v1.3's B5 Skip).

**`pnpm check`:** shared 33/33 · server 106/106 (13 files) · E2E 9/9.

| B9 v1.5 check | Evidence |
|---|---|
| Expiry alerts fire exactly once each at 60, 30 and 7 days | `apps/server/test/care.test.ts` — checkpoints a minute before / at each 09:00-Cairo alert, jobs run twice per checkpoint: counts 0→1→1→2→3→3; one "Renew" task; every member with access got 3. Changing the date re-schedules and the old jobs stay silent; deleting stops them |
| A member without folder access gets 404 | `care.test.ts` — custom folder (B listed, C not): C gets 404 on folder, doc patch, file download, adding a doc, delete; the folder isn't listed; search returns nothing even for OCR text; admins-only folder 404 for members |
| Med reminders fire in the group's timezone | `care.test.ts` — Cairo group 08:00/20:00 → jobs at 06:00Z/18:00Z (winter), nothing at 05:59, one reminder at 06:00, next day re-armed; Dubai group 08:00 → 04:00Z; Cairo in May (summer time) 08:00 → 05:00Z |

**Also tested:** encryption at rest (DB values start `v1:`, stored file bytes differ from the upload, the generic file route
404s vault files), emergency card write rules, arrived-safely/SOS fan-out, Care template content, cross-group 404s.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v1.5/` (vault, meds, safety) — reviewed; fixed a bidi defect where a raw
`2027-03-31` inside Arabic text read as `31-03-2027` (dates now go through `Intl`).

**Seen red:** `care.test.ts`.

**Device checks:** owner checklist items 22–25.

## v2.0 Money & Trips — [x] done

**Built:** multi-currency expenses with a manual rate per expense (stored with the expense; balances and transfers in the
group currency; the sheet shows the converted amount as you type; the history shows "paid in EUR at 52.5"). Budgets (module
`budgets`): per category or everything, per month or for the whole trip/event, progress bars, alerts at 80% and 100%. Dues &
fees (module `dues`): monthly or one-off per member, paid / says-paid / unpaid board, "I paid" → collector confirms,
reminder at 09:00 the day before the due day to whoever hasn't paid or reported, next month's board opens on the 1st.
Contacts (module `contacts`): vendors, doctors, emergency numbers with call/email. Guest list (module `guests`): invite by
link (WhatsApp share or copy), RSVP on the web page without the app with plus-ones (capped per guest) and dietary notes,
live headcount. Trip template (Organizer/Traveller, Itinerary, Packing list) and Event template (Host/Helper/Guest,
Timeline with starter to-dos, guests, budget, vendors). Receipt scan: photo → draft expense.

**Faked:** receipt reading — runs through the AI module (Claude Haiku 5.5 with the image when a key is set; recorded answer in
tests; a demo receipt under `AI_FAKE=1`).

**Skipped:** nothing.

**`pnpm check`:** shared 33/33 (7 files) · server 115/115 (14 files) · E2E 10/10.

| B9 v2.0 check | Evidence |
|---|---|
| A trip settles in one currency using each expense's stored rate | `apps/server/test/money2.test.ts` "multi-currency trip" — EGP trip, €90 at 52.50 → 4,725.00, $30 at 48 → 1,440.00, 300.00 EGP, a second € expense at 55: each keeps its own rate; balances are exact EGP sums of the stored amounts, add to 0, and the suggested transfers clear them; a foreign expense without a rate → 400. E2E: "= 4,725" preview, B owes 2,362.50 |
| Budget alerts fire once at 80% and once at 100% | `money2.test.ts` "budget alerts" — Catering 1,000.00/month: 50% none, other category ignored, 80% one alert, 85% none, 100% one, 110% none; both adults got exactly 2; next month fires 80/100 once each again; a whole-trip `*` budget counts every category and never resets |
| Guest-list RSVPs count plus-ones | `money2.test.ts` "guest list" — HTML form (no JS) going +2, API going asking +4 with max 1 → +1, maybe and no don't count plus-ones → headcount 5; change of mind updates it; removed guest's link → 404. E2E: guest page in a fresh browser (no account) → +2 → host sees headcount 3 |
| Route sweep 404 | `sweep.test.ts` covers the 14 new group routes automatically (non-member 404, no session 401) |
| Cross-group per new entity | `money2.test.ts` "cross-group" — budget, contact, guest, due charge (report + confirm) ids from another group → 404, nothing changed |

**Also tested:** dues board (only the payer can report, only `approve` can confirm, reminder goes to the unpaid only, runs
twice without duplicating, next month's board + reminder without anyone opening the screen), contacts, receipt draft not
saved and another group's file refused, Trip/Event template content. The v1.2 "Child is blocked on every money route" sweep
now switches on every module that has money routes, so the new budget/dues routes are checked for 403 too.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v2.0/` (guests, contacts, expenses, expense sheet with currency + rate,
budgets, dues, the guest RSVP page) — reviewed, no clipped text.

**Seen red:** `money2.test.ts` (headcount assertion; and the roll-over test with the roll-over job removed).

**Device checks:** owner checklist items 26–28.

## v2.2 Gam'eya — [x] done

**Built:** Gam'eya module and Savings Circle template (Organizer/Member). An organizer starts a round: amount per member,
first month, pay-by day, members, payout order agreed (tap order) or drawn by lot on the server. Payment board per month
(paid / says paid / late / due); members tap "I paid", that month's receiver confirms each share; the last share marks the
pot received; the round closes when every month is received. Turn swaps: request → other member accepts → organizer
approves. Reminders the day before the due day at 09:00 group time. Trust record (on time / late per member across rounds).
Today card ("month 2 of 3 · 2,000 due Sat · your turn: month 3 (Dec 2026)"). Next round with the same members.
Tracking only — the app never holds the pot (A12).

**Faked:** nothing (no outside service).

**Skipped:** nothing.

**`pnpm check`:** shared 39/39 (8 files) · server 127/127 (15 files) · E2E 11/11.

| B9 v2.2 check | Evidence |
|---|---|
| Each member receives the pot exactly once per round | `packages/shared/test/gameya.test.ts` (schedule has one month per member; duplicates refused) + `apps/server/test/gameya.test.ts` — a 4-member round run to the end with a swap: 4 distinct receivers, every month received; the database refuses a second slot for the same member (unique index) |
| Total paid in equals total paid out each month | `gameya.test.ts` — every month `paidIn = paidOut = expected = 4 × 2,000.00`; every member's confirmed payments minus what they received = 0; shared test checks the plan the same way |
| A swap needs both members plus the organizer | `gameya.test.ts` — a bystander accepting → 403, a member approving → 403, the other member alone → still pending, the organizer alone → still pending, a decline changes nothing, both + organizer → turns swapped (own-share confirmation moved); started turns → 409. E2E: B asks C, C accepts → "Waiting for an organizer", Amal approves → month 2 shows Carla |
| Route sweep 404 | `sweep.test.ts` picks up the 9 new routes automatically |
| Cross-group per new entity | `gameya.test.ts` "cross-group" — round, payment (report/confirm), swap approve, next round with another group's ids → 404 |

**Also tested:** only the payer reports and only the receiver confirms (403s), reminders reach only members who haven't paid
or reported (jobs run twice, no duplicates), late status after the due day, Today card fields, trust record counts, drawn
order is a permutation, non-adult / duplicate members and past start months refused, next round by organizers only. The
Child money sweep (v1.2) covers the gam'eya routes too (403).

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v2.2/` (board, list, start sheet with numbered order chips, Today card)
— reviewed, no clipped text. The E2E caught a real bug: members who joined while the organizer's screen was open weren't
preselected; fixed.

**Seen red:** `packages/shared/test/gameya.test.ts`, `apps/server/test/gameya.test.ts`.

**Device checks:** owner checklist item 29.

## v2.4 Plans — [x] done

**Built:** plan catalog as data (Free 15 members, Group Pro 100, Plus personal; Business/Property/Community defined for later
phases), `entitlements` table, seat check in every transaction that adds a member (joins and child accounts, with a row
lock), 402 `upgrade_required` error, "group is full" state on the join screen, invite screen and group settings (seats used),
"couldn't join" notification to organizers, paywall screen (Plus + Group Pro, EGP and USD prices, features), Me → Circle Plus.
Admin CLI: `pnpm --filter @circle/server grant -- --group <id> --plan group_pro [--days 30]`, `--user <id|email> --plan plus`,
`--list`, `--revoke <id>` (uses `DATABASE_URL` or `PGLITE_DIR` like the server).

**Faked:** store purchases (RevenueCat) — the app's purchase adapter reports "not connected yet"; plans are granted only by
the admin CLI (B4).

**Skipped:** nothing.

**`pnpm check`:** shared 42/42 (9 files) · server 135/135 (16 files) · E2E 12/12.

| B9 v2.4 check | Evidence |
|---|---|
| The 16th member joining a Free group is rejected with an upgrade error | `apps/server/test/plans.test.ts` — owner + 14 joined; the 16th: preview `full: true`, join → 402 `upgrade_required` `{plan: free, limit: 15, upgradeTo: group_pro}`, still 15 members, owner notified; a child account → 402 too. E2E: 14 players join through the API, number 16 sees "This group is full (15 members)" and no Join button; forcing the API → 402 |
| Group Pro lifts the limit | `plans.test.ts` — CLI grants Group Pro for 30 days → limit 100, members 16 and 17 join; after 31 days → back to 15, nobody removed, the next join → 402; revoke works; Plus doesn't change a group's cap. The CLI script itself runs as a subprocess against a PGlite data directory and refuses to run without a database |
| No client route can grant an entitlement | `plans.test.ts` — every registered route (180+), called by a group owner with grant-shaped bodies and query strings (DELETEs last), plus Better Auth's update-user/sign-in → the entitlements table is unchanged; no write route path mentions plans/purchases; a source scan finds no `insert/update/delete(entitlements)` or grant calls outside `entitlements.ts` and the CLI. Proven red by temporarily adding a route that grants Plus: both checks failed. E2E: the paywall's Upgrade button leaves the group on Free |
| Route sweep 404 | `sweep.test.ts` covers `GET /groups/:groupId/plan` |
| Cross-group | the only new group route is read-only and goes through `requireMember` (sweep: 404 for non-members) |

**Also tested:** entitlement start/expiry/revoke rules and the "most generous plan wins" cap (shared), CLI input errors
(wrong scope, free, unknown group, both/neither subject, bad days). The v1.0 waitlist test uses a 16-person team, so its setup
now grants Group Pro the admin way.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v2.4/` (paywall, full invite screen, Me with Plus, the joiner's "group is
full") — reviewed; found and fixed hard-coded Arabic-Indic digits that ignored the Digits setting (also in older strings).

**Seen red:** `packages/shared/test/plans.test.ts`, `apps/server/test/plans.test.ts` (and the grant sweep with a bad route).

**Device checks:** owner checklist item 30.

## v2.6 Payments — [x] done

**Built:** pay online for a due, a gam'eya share or a debt. The server prices the target, adds the fee (1.5% default, half-up
to minor units, paid on top so the receiver gets the full amount), opens a checkout with the payment provider and returns
the link. A signed webhook (raw body, HMAC-SHA256, 5-minute window) moves the payment to succeeded/failed exactly once
(unique provider event id), applies it (due paid / gam'eya share confirmed, completing the month / confirmed settlement),
issues a receipt (`CIR-2026-000001`, HTML in English or Arabic, printable/PDF) and notifies payer and receiver. App: Pay
online buttons (dues, gam'eya board, settle up), a pay sheet showing amount + fee = total, a payment screen that waits for the
webhook and opens the receipt.

**Faked:** the gateway — `FakeProvider` with a hosted checkout page at `/fake-gateway/checkout/:ref` that succeeds or fails
by amount (.13 declined, .14 insufficient funds) and sends a real signed webhook. Not registered in production.

**Skipped:** nothing.

**`pnpm check`:** shared 45/45 (10 files) · server 143/143 (17 files) · E2E 13/13.

| B9 v2.6 check | Evidence |
|---|---|
| A duplicate webhook produces one payment | `apps/server/test/payments.test.ts` — the same signed event delivered twice → `duplicate: false` then `true`; a second different success event → no effect; exactly one confirmed settlement, one receipt, two stored events; B's debt cleared once |
| A bad signature → 400 and nothing saved | `payments.test.ts` — body changed after signing, wrong secret, no header, garbage header, replay 10 minutes later → all 400 `bad_signature`; no event stored, payment still `created`, no settlement; unknown provider → 404. Proven red by disabling the signature check |
| Fees round correctly in minor units | `packages/shared/test/payments.test.ts` — 200.00 → 3.00 fee; 3.33 → 0.05 (4.995 up); 2.99 → 0.04 (4.485 down); 2.5% + 2.00; 1,350 amounts all whole minor units, total = amount + fee, within half a unit of the exact rate. E2E: 150.00 → fee 2.25, total 152.25 at the gateway |
| Receipts are generated | `payments.test.ts` — paid due → receipt `CIR-2026-NNNNNN`, HTML has amount 200.00, fee 3.00, total 203.00, payer, receiver, purpose; Arabic receipt is RTL; failed and mismatched payments get none. E2E: "Paid ✓" with the receipt number; receipt HTML has 152.25 |
| Route sweep 404 / cross-group | `sweep.test.ts` covers the 4 new group routes; `payments.test.ts` — another group's payment/receipt/due ids → 404; a member who is neither payer nor receiver → 404 |

**Also tested:** fake decline by amount (no settlement, no receipt, payer told, paying the checkout twice sends one event), an
amount-mismatch event fails the payment, gam'eya share via the gateway completes the month (paid in = paid out), the
receiver's own share and already-paid dues are refused (409), paying more than owed or yourself (400), children can't pay,
no gateway → 503 and `payments: false`.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v2.6/` (payment paid with receipt, pay sheet with fee, settled expenses)
— reviewed, no clipped text.

**Seen red:** `packages/shared/test/payments.test.ts`, `apps/server/test/payments.test.ts`.

**Device checks:** owner checklist item 31.

## v2.8 Challenges & Forms — [x] done

**Built:** Challenges module — split a goal into parts (khatma 30 juz' preset, split a book) shared across chosen members in
contiguous blocks, mark parts done, hand back / take / reassign, the next round starts by itself with the blocks rotated (or
early by a manager), join from the next round; daily targets with logs and streak leaderboard. Forms & sign-offs — a builder
(text, yes/no, choice, number, date; required), for everyone or chosen people, answers checked on the server, a signature pad
(finger or mouse) with the typed full name, answers + signatures shown to the coordinator, a printable sheet (HTML with SVG
signatures → PDF), close form. Templates: Faith & Charity (khatma, iftar hosting rota, Donations, Hijri date), Club & Hobby
(meetups, polls, challenges, ideas list), Volunteer / NGO (activities, tasks, Donations, forms).

**Faked:** nothing.

**Skipped:** nothing (volunteer shifts/hours arrive with shifts in v3.4).

**`pnpm check`:** shared 53/53 (12 files) · server 153/153 (18 files) · E2E 14/14.

| B9 v2.8 check | Evidence |
|---|---|
| A khatma splits 30 parts across N members | `packages/shared/test/challenges.test.ts` — N = 1…30: block sizes sum to 30 and differ by ≤ 1; 4 members → 8, 8, 7, 7 contiguous; 35 members → each part one reader. `apps/server/test/packs2.test.ts` — 4 members: 30 parts, 8/8/7/7, Amal 1–8, Dina told "Yours: Juz' 24–30" |
| …and the next round rotates them | shared test — nobody keeps a part in round 2, over 4 rounds each member covers 1–30 exactly once, round 5 = round 1. Server test — finishing all 30 starts round 2 automatically (Amal 9–16, Dina 1–8); rounds 2–4 via "next round" → each member read every part once; a 5th member who joined → 6 parts each. E2E: round 2 moves Amal to 16–30 |
| Form signatures are stored and displayed | `packs2.test.ts` — signature required, malformed answers listed per field, an injected path refused; the stored signature equals what was drawn (`path`, `width`, `height`, `name`, `signedAt`), shown to the member and the coordinator, embedded as `<path d="…">` in the printable sheet; re-answering replaces. E2E: Bassem draws with the mouse → "Signed ✓ · Signed by Bassem"; Amal sees his signature drawn under his answers |
| Route sweep 404 | `sweep.test.ts` covers the 16 new group routes |
| Cross-group per new entity | `packs2.test.ts` — another group's form (view / respond / sheet) and challenge (view / done / reassign) → 404; a form for chosen people → 404 for others |

**Also tested:** only the reader or a manager marks a part, hand back → take → reassign rules, non-participant can't be
assigned, daily target streaks (3 days, correction drops it to 1), future days refused, template modules/starters, Dues →
"Donations" naming, closed form → 409, only coordinators create forms and print sheets.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v2.8/` (form responses with signatures, khatma parts, challenges with
Hijri date, signed form) — reviewed; the challenge card now shows part ranges ("16–30") instead of 15 numbers.

**Seen red:** `packages/shared/test/challenges.test.ts`, `packages/shared/test/forms.test.ts`, `apps/server/test/packs2.test.ts`.

**Device checks:** owner checklist items 32–33.

## v3.0 Work Team pack — [x] done (part of the v3.0–v3.8 line)

**Built:** task board (To do / Doing / Done, sideways on a phone; start, move back, finish), async stand-ups (3 questions,
reminder at 09:30, summary posted to chat at 12:00 on work days, people on leave skipped), meeting notes whose action items
(`- [ ] … @Name by date`) become tasks, leave calendar (book time off, who's off this week, approval when a group asks for it).
The Work Team template gets Stand-ups, Meeting notes and Leave.

**Faked / skipped:** nothing.

**`pnpm check`:** shared 57/57 (13 files) · server 161/161 (19 files) · E2E 15/15.

| Check | Evidence |
|---|---|
| (no v3.x B9 item is about v3.0) | `apps/server/test/work.test.ts` — board moves (403 for others, 409 after done), stand-up reminder only to who hasn't answered (not the person on leave), summary text in chat, the cycle skips Friday/Saturday and resumes Sunday, action items parsed and turned into tasks once (assignee, 17:00 Cairo due), edits keep made tasks, leave overlap 409 / backwards 400, approval flow (pending hidden from others, member can't approve, 409 on second decision) |
| Route sweep 404 | `sweep.test.ts` covers the 12 new routes, and now also fails on duplicate method + path |
| Cross-group per new entity | `work.test.ts` — task stage, meeting edit/tasks, leave approve/delete with another group's ids → 404 |

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v3.0/` (board, stand-ups, meeting notes, leave) — reviewed.

**Seen red:** `packages/shared/test/work.test.ts`, `apps/server/test/work.test.ts` (failed for real first: the `/leave` route clash).

**Fixed along the way:** a race in default member selection (expense split, challenges) found by the E2E suite.

**Device checks:** owner checklist item 34.

## v3.2 Company — [x] done (part of the v3.0–v3.8 line)

**Built:** Company / Business template (Owner / Admin / Manager / Staff / Vendor; checklists, tasks, chat, time off with approval,
SOP wiki, calendar, forms). Custom roles (a base role plus permissions granted or taken away; assign per member; delete falls
back). Departments as sub-groups from the parent's members (leads join all; covered by the parent's plan). Checklists: opening
/ closing (one run per day), onboarding (a run per new hire, created when they join), time-stamped ticks with photo proof,
history and onboarding progress for managers.

**Faked / skipped:** nothing.

**`pnpm check`:** shared 59/59 (14 files) · server 168/168 (20 files) · E2E 16/16.

| B9 v3.x check | Evidence |
|---|---|
| Custom roles pass the sweep | `apps/server/test/company.test.ts` — all modules on, three custom roles (Cashier: +money.write −items.create; Viewer: −items.read −chat −money.read; Supervisor: +items.manage +approve +members.invite), every permission-guarded group route (150+) called by each: 403 exactly where `can()` says no; a custom role still gets 404 in another group. Proven red by making the middleware ignore custom roles (a Viewer could read tasks). E2E: a Cashier can't add a task (403) |
| Route sweep 404 | `sweep.test.ts` covers the 11 new routes |
| Cross-group per new entity | `company.test.ts` — another group's checklist (run / tick) and role → 404; department routes covered by the sweep |

**Also tested:** role definition guards (member 403, owner-only 403, bad id 400, unknown role on assign 400), role deletion,
departments (only chosen people see them, leads are owners there, no nesting, parent's Group Pro lifts the department cap),
checklist ticks (time stamp, 409 twice, photo required, another group's photo refused, completion notifies managers, a new day
starts empty, history for managers only), onboarding runs for new hires and their privacy.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v3.2/` (roles & departments, checklists, home with departments,
checklist run with photo) — reviewed.

**Seen red:** `packages/shared/test/roles.test.ts`, the custom-role sweep in `company.test.ts`.

**Device checks:** owner checklist item 35.

## v3.4 Shifts & time clock — [x] done (part of the v3.0–v3.8 line)

**Built:** shifts (schedule by person or as open shifts, repeat weekly, overnight), overlap and time-off checks, swaps (hand to a
colleague, give back, claim open — a manager approves every change), time clock with a rotating 6-digit code shown as a QR
(scan with the phone camera or type it), clock out, managers close forgotten entries, hours report per person for payroll.
Company template gets Shifts and Time clock; Volunteer gets Shifts.

**Faked:** nothing. **Skipped:** geofence clock-in (B5).

**`pnpm check`:** shared 61/61 (15 files) · server 177/177 (22 files) · E2E 17/17.

| B9 v3.x check | Evidence |
|---|---|
| Overlapping shifts for one person are rejected | `apps/server/test/shifts.test.ts` — inside / overlapping → 409 `overlapping_shift`, back-to-back allowed, other people may share hours, a 3-week repeat that collides in week 2 saves nothing, approved time off → 409 `on_time_off`, two managers booking the same person at once → exactly one 200; shared `overlaps` unit test. E2E: the overlapping shift is refused (409) |
| A shift swap needs manager approval | `shifts.test.ts` — colleague accepting leaves the shift with the owner; manager approve before the colleague → 409; members can't approve (403); approval re-checks overlaps (409, nothing moves); giving back and claiming open shifts also wait for a manager. E2E: Carla accepts → "Waiting for a manager", still Bassem's; Amal approves → Carla's |
| A QR clock-in token expires within 60 s | `apps/server/test/clock.test.ts` — a code is valid until 59.999 s and invalid at 60 s; one shown late in its window lives ~31 s; another group's key never works. `shifts.test.ts` — code fetched, 60 s later → 400 `code_expired`; a fresh one used 59 s later works; only managers see the code. E2E: the manager's code typed by Bassem clocks him in |
| Report totals equal the sum of their rows (hours) | `shifts.test.ts` — rows per person (483 and 270 min), total = sum of rows before and after a manager closes a forgotten entry |
| Route sweep 404 / cross-group | `sweep.test.ts` covers the 13 new routes; `shifts.test.ts` — another group's shift swap / delete and swap approve → 404 |

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v3.4/` (shifts, manager clock with QR and hours, staff clocked in) —
reviewed.

**Seen red:** `packages/shared/test/shifts.test.ts`, `apps/server/test/clock.test.ts`, `apps/server/test/shifts.test.ts`.

**Device checks:** owner checklist items 36–37.

## v3.6 Inventory, assets & approvals — [x] done (part of the v3.0–v3.8 line)

**Built:** inventory (items with unit and threshold, − / + and counts, move history, low items first, one alert per threshold
crossing, reorder → a task assigned to the vendor), assets & maintenance (service every N days, a task on the due morning,
service log with cost, next date), spend requests with limits per role (automatic within your own limit, otherwise an approver
whose limit covers it; owner unlimited; custom roles can have their own limit), vendors as the Contacts module.

**Faked / skipped:** nothing.

**`pnpm check`:** shared 63/63 (16 files) · server 183/183 (23 files) · E2E 18/18.

| B9 v3.x check | Evidence |
|---|---|
| A low-stock alert fires once per threshold crossing | `packages/shared/test/ops.test.ts` (crossing rules) + `apps/server/test/ops.test.ts` — 12 → 6 no alert, → 5 one alert, further uses and a +1 while low no alert, count to 20 re-arms, → 4 second alert; four concurrent uses of the last 3 cups → 3 succeed, 1 gets 409, stock 0, one alert. E2E: two "−" taps from 6 → one "Low stock: Milk" in the manager's inbox |
| Approval limits apply per role | `ops.test.ts` — limits member 50.00 / manager 500.00 / custom Supervisor 200.00: 30.00 auto-approved, 150.00 and 800.00 wait; members can't approve (403); Supervisor and manager can't approve 800.00 (`over_your_limit`), Supervisor approves 150.00, owner approves 800.00; nobody approves their own request. E2E: 30.00 "auto, within the limit", 150.00 waits until Amal approves |
| Route sweep 404 / cross-group | `sweep.test.ts` covers the 14 new routes (and the duplicate-route guard caught the `/approvals` clash); `ops.test.ts` — another group's stock item (move / reorder / history), asset service and spend request → 404 |

**Also tested:** reorder task assigned to the vendor member (who can open it), asset service task created once on the due date
(jobs run twice), service log moves the next date by the interval.

**Arabic screenshots:** `apps/mobile/e2e/screenshots/v3.6/` (inventory with low item, assets, approvals) — reviewed.

**Seen red:** `packages/shared/test/ops.test.ts`, `apps/server/test/ops.test.ts`.

**Device checks:** owner checklist item 38.

## Stopped here (owner's request)

After v3.6 the owner asked to finish one more task and then push and open a pull request. Not started: v3.8 (public booking /
request forms, reports, per-seat billing), v4.x Property, v5.x Community & School, v6.0 Marketplace, v6.3 Open API, v6.6
Template gallery, v6.9 Manager dashboard, v7.0 Cross-group assistant.

