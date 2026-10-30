# Circle — build notes & decisions

Decisions made while the owner is away (SPEC B0/B8). Newest at the bottom of each section.

## Session setup
- **Repository mix-up.** This session was attached to `Sayeh-01/High_level_calc` (a desktop accounting app). The spec lives in
  `Sayeh-01/Circle` (`main` holds only `docs/SPEC.md`). Push access to `Sayeh-01/Circle` was refused for this session, so the
  work is pushed to the designated branch `claude/circle-mobile-app-zm3gcj` of `High_level_calc`. The branch is **based on
  Circle's `main` commit `1d6fcc4` ("Create SPEC.md")**, so it shares history with `Sayeh-01/Circle` and can be pushed there
  and opened as a PR into `main` as-is (see REPORT → "Move the branch").
- `docs/SPEC.md` is the owner's file, unchanged (B1 "save it word for word" is satisfied by building on that commit).

## Stack decisions
- **Expo SDK 58** (latest; spec asks for 56+). `create-expo-app@latest` produced React 19.3 / RN 0.88.
- **pnpm with `node-linker=hoisted`** so Metro resolves workspace packages without symlink issues.
- **`@circle/shared` is consumed as TypeScript source** by Metro, tsx and Vitest (no build step).
- **No `@hono/zod-openapi`.** Routes go through one small helper (`apps/server/src/http.ts`) that applies auth, the
  membership guard, body/query zod validation and records route metadata. The OpenAPI doc (v6.3) is generated from that
  registry with zod 4's built-in `z.toJSONSchema`. Reason: less type machinery, one choke point for authorization.
- **No typed `hc` client in the app.** Importing the server's app type into the mobile package would pull server code into
  the mobile typecheck. The app uses a thin `fetch` client and shared zod types instead.
- **Jobs: own Postgres `jobs` table, not pg-boss.** pg-boss needs a TCP Postgres connection and can't run on in-process
  PGlite, but B1/B3 require the whole suite to run on PGlite. The jobs table gives the same semantics (absolute `run_at`
  computed in the group's timezone, retries with backoff, dead-lettering, dedupe keys). A `setInterval` loop runs it in the
  server. *Brief defect:* B3 (pg-boss) contradicts B1/B3 (suite runs on PGlite without Docker); took the simpler reading.
- **Push: Expo push HTTP API directly, not `expo-server-sdk`.** Same API, chunks of 100, ticket + receipt pruning;
  a plain injectable `fetch` makes B9 #11 ("unit test with mocked fetch") straightforward and avoids a dependency.
- **Recurrence: own RRULE subset** (`packages/shared/src/recurrence.ts`): FREQ D/W/M/Y, INTERVAL, COUNT, UNTIL, BYDAY
  (with ordinals for monthly), BYMONTHDAY. Expanded on local wall time in the IANA zone with `Intl` only. Reason: the
  `rrule` package's timezone handling is the classic source of B7 #3; no tz library needed.
- **Recurring events are materialized** into concrete occurrence rows (35-day horizon, refreshed lazily and by a daily
  job) so RSVPs, capacity and the waitlist work per date. Master rows carry the RRULE and are never listed.
- **Money as `bigint` with Drizzle `mode: 'number'`** — exact up to 2^53 minor units (90 trillion EGP), simpler than BigInt
  in JSON.
- **IDs are text UUIDs** (Better Auth uses text ids too).
- **Realtime auth uses a 60-second signed ticket** (`POST /api/ws-ticket` → `/api/ws?ticket=…`) so web, native and test
  clients authenticate the same way (React Native and Node WebSockets can't reliably send cookies).
- **Files: presigned PUT to `/api/uploads/:token`** (HMAC-signed, 10 min) with a disk driver in dev and memory in tests;
  the R2 driver plugs into the same `FileStorage` interface.

## Product decisions
- Account deletion (B9 #10): owned groups go to the oldest **Admin**; if there is none, to the oldest Manager, then the
  oldest adult Member; a group with nobody else is deleted. The brief only covers "oldest admin" and "nobody else";
  passing to a member avoids deleting other people's data.
- Expenses are never edited, only **reversed** (A14 audit rule); balances skip reversed expenses and rejected settlements.
- A switched-off module's routes answer 404.
- Members may invite by default (`membersCanInvite: true`); admins can turn it off.

## Dependencies added (one line each, B8)
- `hono`, `@hono/node-server`, `@hono/node-ws` — API server + WebSocket (B3).
- `drizzle-orm`, `drizzle-kit`, `@electric-sql/pglite`, `pg` — DB, migrations, in-process Postgres for tests, real Postgres driver (B3).
- `better-auth`, `@better-auth/expo` — auth with Email OTP, Expo client (B3).
- `zod` — shared schemas.
- `nodemailer` — SMTP mailer (B3).
- `tsx`, `vitest`, `typescript` — run/test TS.
- Mobile: `@tanstack/react-query` (+ persist client, async-storage persister, `@react-native-async-storage/async-storage`) — server data cache persisted (B3);
  `i18next`, `react-i18next`, `expo-localization` — i18n (B3); `expo-secure-store` — Better Auth session on native (B7 #7);
  `expo-image-picker` — photos for chat/proof; `expo-clipboard` — copy invite code; `expo-notifications` — push;
  `expo-print`, `expo-sharing` — PDFs (B3); `qrcode-generator` — invite QR rendered with plain Views (no native SVG needed);
  `@playwright/test@1.63.0` — E2E, pinned to the preinstalled browser build.

## v1.0 plan (B10)
1. pnpm workspace, shared package (money, rotation, recurrence, permissions, templates, zod schemas) — tests first.
2. Drizzle schema + first migration; PGlite test harness with real OTP sign-in.
3. Route helper = single authorization choke point; route sweep + cross-group tests from day one.
4. Groups/templates/invites → tasks/lists/events/Today → expenses/polls/chat/activity/realtime → push + account deletion.
5. Expo app: tabs (Today · Groups · + · Inbox · Me), group home + module tabs, all module screens, Arabic/RTL.
6. Playwright against the exported web build served by the API (same origin → cookie sessions just work).

## v1.0 review pass (1 round)
- Found: WebSocket route registered after the `/api/*` 404 catch-all → never connected (caught by E2E). Fixed: realtime
  registers inside `createApp` before catch-alls; real-socket test added.
- Found: persisted query cache restored as "fresh" after reload → stale screens. Fixed: invalidate after restore and on
  every socket (re)connect.
- Found: Arabic plural forms missing (fell back to English). Fixed with `_zero/_one/_two/_few/_many/_other`.
- Found: group `photo` accepted any id; dev origin trusted in production. Fixed.
- Left as is: profile photos (`/api/photos/:id`) are readable by any signed-in user who has the id (ids are only shown to
  people who share a group). API routes have no rate limiting outside Better Auth until v6.3.
- Native RTL switch needs an app restart (B7 #5). In dev the app reloads itself (`DevSettings.reload`); in production
  builds we ask the user to reopen the app instead of adding `expo-updates` just for `reloadAsync`. Owner device check #5.
- Date/time input uses day chips + an HH:MM field instead of a native picker (no extra native module, works on web).
- Quiet hours / daily digest (A9) have no version in B5; not built.

## v1.1 plan
1. Guest links as data (`guest_links`: group, token, entity, entity id, revoked_at); one resolver = the guest form of the
   membership guard (unknown/revoked token or other item id → 404).
2. Server-rendered guest pages (no JS) with OG tags for WhatsApp cards; JSON API for the same actions.
3. ICS feed per user with a revocable token; universal-link files from env.
4. Phone OTP via Better Auth plugin + SMS adapter; Google/Apple from env vars.

## v1.1 decisions
- Guest pages live at `/p/:token` because the app already uses `/g/:groupId`.
- Guest RSVPs are rows in `event_rsvps` with `user_id = guest:<uuid>` (uuid kept in an httpOnly cookie) and `guest_name`,
  so capacity and the waitlist count guests with no special cases. `notify()` skips `guest:` ids.
- "See what they owe / confirm payment" through a guest link (A9) needs non-members inside expense splits; not in the B5
  v1.1 row's must-prove list, so guests get event RSVP + list view only (feature stop rule: simplest form).
- The install prompt shows from the third guest visit ("after their second interaction"), counted in a cookie.
- Phone sign-up creates a placeholder email `<digits>@phone.circle.invalid` (Better Auth requires an email).
- Found in review: the creator's socket did not subscribe to a newly created group → creating a group emits a membership
  event to the creator.

## v1.2 plan
1. Points as a ledger table (task / redeem / refund / adjust), balance = SUM; redemption locks the member row first.
2. Streaks and fairness as pure functions in shared (group timezone), tested there.
3. Child accounts = real users with `is_child`, `managed_by`, PIN hash; sign-in via a Better Auth plugin endpoint so the
   session cookie is Better Auth's own (works with the Expo plugin on native).
4. Chore approval for Children (setting `childApproval`, default on).
5. Voice notes: `expo-audio` recorder on native, `<audio>` on web; messages get `audio_file_id`, `audio_ms`.

## v1.2 decisions
- A Child's completion is `pending` until an approver approves; points are added on approval (A6 "parent approval").
- "No links outside the family" is enforced server-side: Children can't create groups, preview/join invites or create guest
  links. AI is not built yet; when it is (v1.4), Child accounts get no AI routes.
- **React Compiler turned off** (`experiments.reactCompiler: false`). It was on in the SDK 58 template; it produced a
  render-time crash (reads `obj.prop` used only inside an event handler). Stability over a small render optimisation.
- Kids home lists every open chore assigned to the child (dated or not), unlike adult Today (7-day window per spec).
- The fairness meter counts chore points earned this calendar month (group timezone); the spec doesn't define the window
  beyond "this month".
- `expo-audio` — voice notes record/play (v1.2, B3 Expo SDK module).
- `expo-haptics` — success haptic on completing a chore (A13 design).

## v1.3 plan
1. Pure logic first: exact balancer (DP over size × skill sum) + SM-2, each checked against independent tests.
2. Sport tables: skills, match votes (PK event+voter), carpool offers/riders. Study tables: focus sessions, countdowns,
   decks/cards/per-member reviews, pages.
3. Presence reuses the v1.0 WebSocket rooms; REST focus sessions give minutes/streaks.

## v1.3 decisions
- Sport features (balancer, MOTM, attendance, carpool) live in one module `teams` ("Team builder" in A7) so a template
  switches them on with one entry. Exam countdowns live in the `focus` module.
- MOTM votes can't be changed (strict reading of "one vote per player per match"); voting opens at kick-off.
- Attendance = RSVP "going" for past, non-cancelled events (no separate check-in); a no-show marker can be added later.
- A focus session counts at most 3 hours if the app never sent "stop".
- Home-screen widgets: Skip per B5 (owner's list in REPORT).

## v1.4 plan
1. `mergeIngredients` in shared (tested), meals + memories tables, to-list merges into open list lines.
2. Yearly book = server HTML with embedded photos → expo-print on device.
3. One `AiModel` interface: Claude (official SDK; Haiku 5.5 structured output for parsing, Sonnet 5.5 for summaries),
   recorded fake for tests, rule-based fake behind `AI_FAKE=1` for E2E. Every AI route returns drafts; ids in a model's
   answer are re-checked against what the user can see.

## v1.4 decisions
- Model ids follow the spec (A10): `claude-haiku-5-5` for parsing, `claude-sonnet-5-5` for summaries/assistant. Parsing runs
  at effort `low` (cheap, fast); the Sonnet call opts into the server-side refusal fallback (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`) per the Claude API guidance.
- The model only ever sees groups where the user may create items, with member display names (no emails/phones).
- `@anthropic-ai/sdk` added (server only) — official SDK for Claude (B4 ai module).
- Grocery merge does not convert between units (500 g + 1 kg stay two lines) — no silent unit maths.
- Web "yearly book" uses the browser print dialog (expo-print's PDF file + share sheet is native-only).

## v1.5 plan
1. AES-256-GCM `seal`/`open` helpers (key from `DATA_KEY`); vault files flagged `encrypted` are sealed on upload.
2. Vault folders with an ACL function used by every vault route; no access = 404.
3. Expiry alerts as three dedupe-keyed jobs per (doc, threshold, date); meds as one self-re-arming job per dose time.
4. Emergency card as one sealed JSON blob per member; arrived/SOS as notifications only (no location).

## v1.5 decisions
- Sensitive data at rest: vault file bytes, vault notes + OCR text, emergency cards, med notes. Group names, titles and dates
  stay plaintext (needed for lists/sorting). Search decrypts the group's documents in memory (fine at family scale).
- Owner/Admin always see every vault folder (they manage access); "everyone" means adult members (managers/members), not
  Children (the permission matrix already gives Children no vault access).
- Expiry alerts go out at 09:00 group time on the threshold day; the 60-day alert creates the "Renew" task (A8), due 30
  days before expiry.
- "Arrived safely" sends no location (A6 "no continuous tracking").
- Dates typed as YYYY-MM-DD in forms for now (no native date picker); shown through Intl.

## v2.0 plan
1. Multi-currency was stored per expense since v1.0 (`currency`, `originalMinor`, `rate`); v2.0 adds the UI (currency + manual
   rate, live conversion preview) and a trip test across EUR/USD/EGP.
2. Budgets: alert check runs inside each expense's transaction (`expenseHooks`); a `(budget, period, threshold)` row makes
   each alert fire once.
3. Dues: one charge row per payer per period (`payerKey` is a user id now, a unit id in v5); report → confirm; reminder job
   the day before; a roll-over job opens next month's board on the 1st.
4. Guest list: invitees are not members; each gets an `invitee` guest link and RSVPs on the server-rendered `/p/:token` page.
5. Contacts directory; Trip + Event templates; receipt scan → draft expense (AI module, image input).

## v2.0 decisions
- Rates are typed by hand as "1 FOREIGN = x GROUP" (B5: manual rates). The rate is stored on the expense and never
  re-applied; balances and transfers are always in the group currency. Exact splits are typed in the original currency.
- Budget categories are free text on the expense (`category`), `*` = everything. Monthly budgets use the group's timezone
  and the expense's `spentAt` month; `total` budgets never reset. Reversing an expense doesn't re-arm an alert already sent
  that period. Alerts go to owner/admin/manager/member (not Children or guests).
- Setting a budget needs `group.settings`; creating a due and confirming payments need `approve`; members report "I paid".
  No online payment until v2.6.
- Dues isn't a default module on any v2.0 template (the spec's dues templates — Faith, Volunteer, Building, Class — come
  later); any group can switch it on in Settings.
- Plus-ones are capped per guest by the host (`maxPlusOnes`, 0–10); headcount = guests going + their plus-ones. Removing a
  guest revokes their link.
- Receipt scan uses Haiku 5.5 with the image (draft only, `saved: false`); a receipt in the group currency comes back as
  currency null → the group currency. The phone pre-fills the expense sheet; the person picks who shares it and saves.
- No new dependencies.

## v2.2 plan
1. Pure helpers in shared (`gameyaSchedule`, `drawOrder`, `swapTurns`, month maths) with unit tests.
2. Tables: round, one slot per month (PK round+position, unique round+member → a member can't receive twice), one payment
   row per payer per month, swaps with the other member's and an organizer's approval timestamps.
3. Routes behind `requireMember` (module `gameya`, `money.read`; starting a round and approving swaps need `approve`).
4. Reminder job per month (day before the due day, 09:00 group time), Today card, board + trust record on the phone.

## v2.2 decisions
- Everyone pays every month, the receiver too; the receiver's own share is confirmed at once (it never leaves their hands)
  and moves with the turn on a swap. Paid in = expected = amount × members every month; the pot counts as paid out when
  the receiver has confirmed every share.
- Only that month's receiver confirms a share (A6 "the receiver confirms"); payers can report "I paid" any time (paying
  early is allowed).
- Swaps: only turns that haven't started (both months after the current one, nothing confirmed to either receiver). The
  requester asks; the other member accepts; an organizer (owner/admin, `approve`) approves, in any order. An organizer who
  is one of the two members covers the organizer approval with their own consent. One open request per requester.
- Drawn order uses `crypto.randomInt` on the server, shown to everyone at once; agreed order is the order the organizer taps.
- One share per member per round (no half or double shares, "سهمين") — keeps "receives exactly once" literal; owner can ask.
- Trust record = every share that fell due (or was settled early) across all rounds in the group, on time if reported or
  confirmed by the due day; the receiver's own share isn't counted.
- A member leaving the group mid-round keeps their slot and payments (history matters); the organizer settles it in chat.
- Next round: same members still in the group, drawn again if it was drawn, starts the month after the last round (or this
  month if that's past).
- No new dependencies.

## v2.4 plan
1. Plans as data in shared (`PLANS`, `memberLimit`, `isActive`) with unit tests.
2. `entitlements` table; `grantEntitlement`/`revokeEntitlement` called only by the admin CLI (`scripts/grant-entitlement.ts`).
3. One seat check (`assertSeat`) inside every transaction that adds a member (join, child accounts), with a row lock.
4. Read-only routes (`/plans`, `/me/plan`, `/groups/:id/plan`); paywall screens behind a fake purchases adapter.
5. Tests: 16th member → 402, Group Pro lifts it, expiry, and a sweep of every route proving none grants a plan.

## v2.4 decisions
- What's enforced now is exactly B9's limit: Free groups hold 15 members (children count), Group Pro 100. Feature gates for
  Plus / Group Pro features (AI, vault, dues, exports…) are listed on the paywall but NOT enforced: A16 says to validate
  prices with interviews before building a paywall, and gating shipped features would break existing groups. Owner decides
  (open question).
- The cap error is HTTP 402 `upgrade_required` with `{ plan, limit, members, upgradeTo }`. The invite preview says `full`,
  so the join screen shows the message instead of a Join button; organizers get a "couldn't join" notification that opens
  the Group Pro paywall.
- When Group Pro lapses nobody is removed; new joins stop until the group is back under the cap or renews.
- No HTTP route writes entitlements, not even a store webhook yet. RevenueCat will come as a server-to-server webhook with its
  own secret; the phone never tells the server "I paid". Until then the app's purchase adapter reports "not connected yet".
- The CLI refuses to run against an in-memory database (it would forget the grant) and refuses child accounts.
- Business / Property / Community plans exist as data (not sold) for their phases.
- Fixed in passing: some Arabic strings had hard-coded Arabic-Indic digits that ignored the Digits setting; strings now use
  Western digits and the digits post-processor converts them (plan data goes through the same `localDigits`).
- No new dependencies (`node:util` parseArgs for the CLI).

## v2.6 plan
1. `paymentQuote` in shared (fee in basis points, half-up to minor units; payer pays amount + fee).
2. `PaymentProvider` interface + `FakeProvider` with a hosted checkout page under `/fake-gateway`, Stripe-style signed
   webhooks (`t=…,v1=HMAC-SHA256(t.body)`, 5-minute tolerance, raw body, constant-time compare).
3. Tables: payments, payment_events (unique provider + event id → idempotency), receipts (sequence → `CIR-YYYY-000001`).
4. Payable: a due charge, a gam'eya share, a debt (settle up). The client names the target; the server prices it.
5. Pay sheet (amount + fee = total) → gateway → back to a payment screen that waits for the webhook → receipt.

## v2.6 decisions
- The gateway pays the receiver directly; Circle never holds a balance (A12 stage 2). The payer pays the fee on top so the
  receiver gets exactly what was owed (dues and gam'eya totals stay exact). Fee from `FEE_BPS` (default 150 = 1.5%) and
  `FEE_FIXED_MINOR` (default 0) — A16's 1–2.5% is a hypothesis.
- Balances, dues and gam'eya shares change only on a verified `payment.succeeded` webhook, never on the redirect back.
  A gateway settle-up is a confirmed settlement (method `gateway`); a due charge / gam'eya share is confirmed by `gateway`.
- Webhook handling: bad or stale signature → 400, nothing stored; a repeated event id → 200 `duplicate: true`, nothing
  changes; a second different event for a finished payment → stored, no effect; amount/currency mismatch → payment failed
  (`amount_mismatch`), nothing applied; unknown providerRef → acknowledged (200) so the gateway stops retrying.
- If two checkouts for the same due both succeed, the second is kept as succeeded with `duplicate_target` for a refund
  through the gateway (refund API comes with the real gateway).
- Fake gateway rule (B4 "succeeds or fails depending on the amount"): totals ending in .13 → `card_declined`, .14 →
  `insufficient_funds`, else success. It exists outside production only; in production with no gateway configured the
  routes answer 503 and the app hides Pay buttons (`/api/config` → `payments: false`).
- Who sees a payment: the payer, the receiver, and members with `approve` (collectors); everyone else gets 404.
- "Dues unpaid → reminder → pay link" (A8): the dues reminder opens the dues screen, which now has "Pay online".
- No new dependencies (node:crypto).

## v2.8 plan
1. Shared: `partBlocks` / `assignParts` (contiguous blocks, rotated one block per round), `partRanges`; form field types,
   `validateAnswers`, a strict signature schema (`M x y L x y …` in pad pixels). Unit tests first.
2. Server: challenges (split + tally), parts per round, daily logs; forms with an audience, responses with signatures,
   printable sheet with inline SVG signatures.
3. App: challenges (presets: khatma 30 juz', split a book, daily target), part grid, forms builder, fill + signature pad.
4. Templates: Faith & Charity, Club & Hobby, Volunteer / NGO.

## v2.8 decisions
- Rotation: round r gives member i block (i + r − 1) mod N, so nobody repeats their parts and after N rounds everyone has read
  every part once. The last part done starts the next round automatically (A6 "automatic reassignment"); a manager can also
  start it early. More members than parts: the extra members simply have no part that round and the turn moves on.
- A member who hands a part back frees it; any participant can take a free part; managers (creator or `items.manage`) can
  reassign. New participants join from the next round (the current split doesn't change under people's feet).
- Daily targets: one number per member per day (correcting a day replaces it); the streak counts consecutive days at or over
  the target (yesterday counts until today is logged), reusing `computeStreak`.
- Forms are created by `approve` (coordinators/admins); a form for chosen people is 404 for everyone else (like vault
  folders). Answering again replaces your answer until the form closes.
- Signatures are drawn as strokes and stored as `{ path, width, height, name }` + `signedAt` — the typed full name is shown
  under the drawing. The path grammar is only `M`/`L` with whole numbers inside the pad, so it can be embedded as inline SVG
  safely. The phone draws it with rotated Views (no SVG native module → no new dependency; B8).
- Dues show as "Donations" for Faith and Volunteer (`moduleNames` on the template). Hijri date (Umm al-Qura) on the Faith
  challenges screen (A14).
- Volunteer shifts and hours (A6) come with shifts in v3.4.
- No new dependencies.

## v3.0–v3.8 approach
One PROGRESS line covers five roadmap steps (A17). Each step is built, checked, documented and pushed on its own
(v3.0 work pack, v3.2 company, v3.4 shifts + clock, v3.6 inventory/assets/approvals, v3.8 public forms + reports); the line
stays `[~]` until v3.8 is done.

## v3.0 plan
Board stage on tasks (a `stage` column so every "open task" query keeps working), stand-ups (answers per day, self-re-arming
reminder 09:30 + summary 12:00 posted to chat on work days), meeting notes with parsed action items → tasks, a leave calendar
(with an approval switch Company groups will use in v3.4).

## v3.0 decisions
- Work days: Sunday–Thursday for Egypt and the Gulf states that work them, Monday–Friday elsewhere; a group setting
  `workDays` overrides. Members on approved leave aren't reminded and are listed as "off" in the summary.
- The summary is a chat message from a `system` author (shown as "🤖 Circle"). Stand-up jobs start the first time someone
  opens or answers the stand-up screen, then keep re-arming themselves.
- Action items: lines `- [ ] …`, `[ ] …`, `TODO: …`, `AI: …`; a trailing `@FirstName` assigns, `by YYYY-MM-DD` sets the due
  date (17:00 group time). Creating tasks is idempotent; editing notes keeps items already turned into tasks.
- Leave paths are `/time-off` because `POST /groups/:id/leave` already means "leave the group" (v1.0) — the clash was caught by
  the tests, and the route sweep now fails on any duplicate method + path.
- Defaults that list members (expense split, challenge participants, gam'eya members) now follow the member list until the
  user edits them — an E2E run caught a race where someone who had just joined was left out of a split.
- No new dependencies.

## v3.2 plan
Company template; custom roles (define/delete routes on top of the existing `can()` support, escalation guard
`customRoleProblem`); departments as sub-groups (`groups.parentId`); checklists with per-day runs (opening/closing) and
per-hire runs (onboarding via `onJoinHooks`), time stamps and photo proof; SOP wiki = Notes renamed by the template.

## v3.2 decisions
- Custom roles live in group settings (`customRoles[id] = { name, base, grant, deny }`); only `group.settings` holders define
  them; no owner-only rights (`group.delete`, `group.transfer`), no grant the definer lacks, base never `owner`. Deleting a role
  sends its members back to their base role.
- B9 "custom roles pass the sweep": a test calls every permission-guarded group route as three custom-role members and checks
  each answer against `can()` (403 exactly when the matrix says no); proven red by making the middleware ignore custom roles.
- Departments: one level deep, members chosen from the parent; the parent's owner/admins join every department with their
  roles; a department is covered by the parent's plan (Group Pro lists sub-groups). Removing someone from the parent doesn't
  yet remove them from its departments (owner can remove them there).
- Checklists: items marked 📷 need a photo uploaded to the group; a tick can't be undone (it's a time-stamped record); managers
  see history and onboarding progress; members can't open someone else's onboarding run.
- Company groups need a manager's approval for time off (`leaveApproval: true` from the template defaults).
- No new dependencies.

## v3.4 plan
Shifts (overlap check under a row lock, weekly repeats checked together, approved time off blocks a shift), swaps (owner →
colleague → manager, give back to open, claim open; manager approval re-checks overlap), time clock (6-digit TOTP-style code
per group, shown as a QR by managers, typed or opened from the QR link by staff), hours report.

## v3.4 decisions
- Clock code: HMAC(server secret + group id, 30-second window) → 6 digits; accepted in its window and the next, so never
  older than 60 s (B9). It's computed only on the server (`node:crypto`), so it isn't in the shared package.
- No camera module: the QR encodes `circleapp://g/<id>/clock?code=…`, which the phone's own camera app opens, and the same
  screen takes the code typed (the B7 #13 web fallback). Geofence clock-in is a B5 Skip.
- Clock-in links to the person's shift that starts within 2 hours (for later reports). Forgotten clock-outs are closed by a
  manager with a time; the report lists still-open entries separately and counts only closed ones.
- Swaps: every change of hands needs a manager (B9) — even claiming an open shift or giving one back. One pending swap per
  shift. A shift that has started can't be swapped.
- Shifts are 0–16 hours; an end time before the start in the app means "overnight".
- Volunteer / NGO also gets Shifts (A5).
- No new dependencies.

## v3.6 plan
Inventory (one locked path for every stock change, a `low` flag that makes the alert fire once per crossing, move history,
reorder → task for the vendor), assets (service every N days, a due-date job that creates one task, service log moves the
date on), spend requests with limits per role (custom role limit first, then base role; owner unlimited), vendors = Contacts.

## v3.6 decisions
- Low stock: alert when the quantity goes from above the threshold to at/below it; while it stays low there's no repeat;
  a restock above the threshold re-arms it (B9). Stock can't go below zero (409); concurrent uses are serialized by a row
  lock, so the last item can't be used twice.
- Approval limits live in group settings (`approvalLimits`), keyed by base role or custom role id, in minor units. A request
  within the requester's own limit is approved at once (`decidedBy: 'auto'`); otherwise only someone with `approve` whose own
  limit covers the amount can approve; nobody approves their own request. Members see only their own requests.
- Spend requests use `/spend-requests` paths because `GET /groups/:id/approvals` is the v1.2 chore approvals list — the
  duplicate-route guard in the sweep test would have failed.
- Company template gets Inventory, Approvals, Assets and Contacts (shown as "Vendors").
- No new dependencies.

## Paused after v3.6
The owner asked (mid-run) to finish one more task, then push and open a pull request. v3.6 was that task; v3.8 and later are
not started.

