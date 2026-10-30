import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'number' });

// ── Better Auth (usePlural) ───────────────────────────────────────────────────
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  language: text('language').notNull().default('en'),
  digits: text('digits').notNull().default('latn'),
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified'),
  /** v1.2 Child accounts: no email, PIN login on a shared device, managed by a parent. */
  isChild: boolean('is_child').notNull().default(false),
  managedBy: text('managed_by'),
  pinHash: text('pin_hash'),
  pinFailed: integer('pin_failed').notNull().default(0),
  pinLockedUntil: ts('pin_locked_until'),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: ts('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ── Groups ────────────────────────────────────────────────────────────────────
export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull().default('✨'),
  color: text('color').notNull().default('#8A8F98'),
  photo: text('photo'),
  modules: text('modules').array().notNull().default(sql`'{}'::text[]`),
  currency: text('currency').notNull().default('EGP'),
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  parentId: text('parent_id'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    customRoleId: text('custom_role_id'),
    displayName: text('display_name').notNull(),
    away: boolean('away').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false),
    lastReadAt: ts('last_read_at').notNull().defaultNow(),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('group_members_user_idx').on(t.userId)],
);

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  revokedAt: ts('revoked_at'),
  uses: integer('uses').notNull().default(0),
});

export const groupLinks = pgTable('group_links', {
  id: text('id').primaryKey(),
  aGroupId: text('a_group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  bGroupId: text('b_group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  scopes: jsonb('scopes').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    assigneeId: text('assignee_id'),
    rotation: text('rotation').array(),
    dueAt: ts('due_at'),
    rrule: text('rrule'),
    points: integer('points').notNull().default(0),
    status: text('status').notNull().default('open'),
    /** v3.0 board column for open tasks: todo | doing */
    stage: text('stage').notNull().default('todo'),
    completedAt: ts('completed_at'),
    completedBy: text('completed_by'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('tasks_group_idx').on(t.groupId), index('tasks_assignee_idx').on(t.assigneeId)],
);

export const taskCompletions = pgTable('task_completions', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  userId: text('user_id').notNull(),
  photoFileId: text('photo_file_id'),
  points: integer('points').notNull().default(0),
  dueAt: ts('due_at'),
  completedAt: ts('completed_at').notNull().defaultNow(),
  /** v1.2: a Child's chore waits for a parent's approval before points are awarded. approved | pending | rejected */
  status: text('status').notNull().default('approved'),
  reviewedBy: text('reviewed_by'),
});

/** Threads on any item (task comments now; any entity later). */
export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    userId: text('user_id').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('comments_entity_idx').on(t.entity, t.entityId)],
);

// ── Events ────────────────────────────────────────────────────────────────────
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Recurring events: the master row has rrule and no seriesId; occurrences point at the master. */
    seriesId: text('series_id'),
    title: text('title').notNull(),
    notes: text('notes'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    rrule: text('rrule'),
    tz: text('tz').notNull(),
    location: text('location'),
    capacity: integer('capacity'),
    waitlist: boolean('waitlist').notNull().default(false),
    reminderMin: integer('reminder_min'),
    materializedUntil: ts('materialized_until'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [index('events_group_idx').on(t.groupId, t.startsAt), uniqueIndex('events_series_start_uq').on(t.seriesId, t.startsAt)],
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    /** going | maybe | no | waitlist */
    status: text('status').notNull(),
    waitlistPos: integer('waitlist_pos'),
    /** v1.1: RSVPs from guest links (userId = `guest:<id>`) carry the name the guest typed. */
    guestName: text('guest_name'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

// ── Lists ─────────────────────────────────────────────────────────────────────
export const lists = pgTable('lists', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  archivedAt: ts('archived_at'),
});

export const listItems = pgTable(
  'list_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    title: text('title').notNull(),
    qty: text('qty'),
    category: text('category'),
    checked: boolean('checked').notNull().default(false),
    checkedBy: text('checked_by'),
    checkedAt: ts('checked_at'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('list_items_list_idx').on(t.listId)],
);

// ── Money ─────────────────────────────────────────────────────────────────────
export const expenses = pgTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** In the group currency (after the stored rate for foreign expenses). */
    amountMinor: money('amount_minor').notNull(),
    /** Original currency + amount + manual rate (v2.0 multi-currency). */
    currency: text('currency').notNull(),
    originalMinor: money('original_minor').notNull(),
    rate: doublePrecision('rate').notNull().default(1),
    payerId: text('payer_id').notNull(),
    splitKind: text('split_kind').notNull(),
    category: text('category'),
    eventId: text('event_id'),
    taskId: text('task_id'),
    spentAt: ts('spent_at').notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    /** Money entries are never edited; a reversal marks them. */
    reversedAt: ts('reversed_at'),
    reversedBy: text('reversed_by'),
  },
  (t) => [index('expenses_group_idx').on(t.groupId)],
);

export const expenseShares = pgTable(
  'expense_shares',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);

export const settlements = pgTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    method: text('method').notNull(),
    note: text('note'),
    createdAt: createdAt(),
    confirmedAt: ts('confirmed_at'),
    rejectedAt: ts('rejected_at'),
  },
  (t) => [index('settlements_group_idx').on(t.groupId)],
);

// ── Polls ─────────────────────────────────────────────────────────────────────
export const polls = pgTable('polls', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  multi: boolean('multi').notNull().default(false),
  anonymous: boolean('anonymous').notNull().default(false),
  closesAt: ts('closes_at'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const pollOptions = pgTable('poll_options', {
  id: text('id').primaryKey(),
  pollId: text('poll_id')
    .notNull()
    .references(() => polls.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
});

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: text('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    optionId: text('option_id')
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.optionId, t.userId] })],
);

// ── Chat ──────────────────────────────────────────────────────────────────────
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    body: text('body').notNull().default(''),
    imageFileId: text('image_file_id'),
    /** v1.2 voice notes */
    audioFileId: text('audio_file_id'),
    audioMs: integer('audio_ms'),
    replyToId: text('reply_to_id'),
    mentions: text('mentions').array(),
    pinned: boolean('pinned').notNull().default(false),
    pinnedAt: ts('pinned_at'),
    pinnedBy: text('pinned_by'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('messages_group_idx').on(t.groupId, t.createdAt)],
);

export const announcementReads = pgTable(
  'announcement_reads',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    readAt: ts('read_at').notNull().defaultNow(),
    acknowledgedAt: ts('acknowledged_at'),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

// ── Activity, notifications, files, jobs ──────────────────────────────────────
export const activity = pgTable(
  'activity',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: text('actor_id'),
    verb: text('verb').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('activity_group_idx').on(t.groupId, t.createdAt)],
);

export const pushTokens = pgTable('push_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  platform: text('platform').notNull(),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  groupId: text('group_id'),
  ownerId: text('owner_id').notNull(),
  key: text('key').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull().default(0),
  uploadedAt: ts('uploaded_at'),
  /** v1.5: vault files are stored encrypted at rest */
  encrypted: boolean('encrypted').notNull().default(false),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    runAt: ts('run_at').notNull(),
    /** pending | done | failed | dead */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').unique(),
    createdAt: createdAt(),
    doneAt: ts('done_at'),
  },
  (t) => [index('jobs_due_idx').on(t.status, t.runAt)],
);

// ── v1.1 Reach ────────────────────────────────────────────────────────────────
/** A web link that lets someone without the app act on exactly one item (B6: guests pass the same guard, narrower scope). */
export const guestLinks = pgTable('guest_links', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  revokedAt: ts('revoked_at'),
});

/** Secret per-user URL for the read-only ICS calendar feed. */
export const calendarTokens = pgTable('calendar_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
  revokedAt: ts('revoked_at'),
});

// ── v1.2 Motivation ───────────────────────────────────────────────────────────
/** Points are a ledger: balance = sum(delta). Never a stored running total. */
export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    delta: integer('delta').notNull(),
    /** task | redeem | refund | adjust */
    reason: text('reason').notNull(),
    refId: text('ref_id'),
    createdAt: createdAt(),
  },
  (t) => [index('points_ledger_member_idx').on(t.groupId, t.userId)],
);

export const rewards = pgTable('rewards', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  emoji: text('emoji').notNull().default('🎁'),
  cost: integer('cost').notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const redemptions = pgTable('redemptions', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  rewardId: text('reward_id')
    .notNull()
    .references(() => rewards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  cost: integer('cost').notNull(),
  /** pending | fulfilled | cancelled */
  status: text('status').notNull().default('pending'),
  createdAt: createdAt(),
  resolvedAt: ts('resolved_at'),
  resolvedBy: text('resolved_by'),
});

// ── v1.3 Sport & Study ────────────────────────────────────────────────────────
export const memberSkills = pgTable(
  'member_skills',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    skill: doublePrecision('skill').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/** One vote per player per match: the primary key is (event, voter). */
export const matchVotes = pgTable(
  'match_votes',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    voterId: text('voter_id').notNull(),
    nomineeId: text('nominee_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.voterId] })],
);

export const carpoolOffers = pgTable('carpool_offers', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  eventId: text('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  driverId: text('driver_id').notNull(),
  seats: integer('seats').notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

export const carpoolRiders = pgTable(
  'carpool_riders',
  {
    offerId: text('offer_id')
      .notNull()
      .references(() => carpoolOffers.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    eventId: text('event_id').notNull(),
    userId: text('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.userId] }), uniqueIndex('carpool_rider_event_uq').on(t.eventId, t.userId)],
);

export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
  },
  (t) => [index('focus_group_idx').on(t.groupId, t.startedAt)],
);

export const countdowns = pgTable('countdowns', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  at: ts('at').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const decks = pgTable('decks', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const cards = pgTable('cards', {
  id: text('id').primaryKey(),
  deckId: text('deck_id')
    .notNull()
    .references(() => decks.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  front: text('front').notNull(),
  back: text('back').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

/** Each member has their own SM-2 schedule per card. */
export const cardReviews = pgTable(
  'card_reviews',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    groupId: text('group_id').notNull(),
    ease: doublePrecision('ease').notNull(),
    interval: integer('interval').notNull(),
    reps: integer('reps').notNull(),
    dueAt: ts('due_at').notNull(),
    reviewedAt: ts('reviewed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.userId] })],
);

export const pages = pgTable('pages', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ── v1.4 Life ─────────────────────────────────────────────────────────────────
export const meals = pgTable(
  'meals',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Local calendar day in the group timezone, YYYY-MM-DD. */
    day: text('day').notNull(),
    slot: text('slot').notNull(),
    title: text('title').notNull(),
    ingredients: jsonb('ingredients').$type<{ name: string; qty?: number | null; unit?: string | null }[]>().notNull().default([]),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('meals_group_day_idx').on(t.groupId, t.day)],
);

export const memories = pgTable(
  'memories',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    day: text('day').notNull(),
    text: text('text').notNull().default(''),
    photoFileIds: text('photo_file_ids').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [index('memories_group_day_idx').on(t.groupId, t.day)],
);

// ── v1.5 Care & Safety ────────────────────────────────────────────────────────
export const vaultFolders = pgTable('vault_folders', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** all = every adult member · admins = owner/admin only · custom = owner/admin + memberIds */
  access: text('access').notNull().default('all'),
  memberIds: text('member_ids').array().notNull().default(sql`'{}'::text[]`),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const vaultDocs = pgTable(
  'vault_docs',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => vaultFolders.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    fileId: text('file_id'),
    /** Local calendar day the document expires (YYYY-MM-DD). */
    expiresOn: text('expires_on'),
    /** Encrypted (seal.ts). */
    notes: text('notes'),
    ocrText: text('ocr_text'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('vault_docs_folder_idx').on(t.folderId)],
);

/** One per member per group; the whole card is one encrypted JSON blob. */
export const emergencyCards = pgTable(
  'emergency_cards',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    data: text('data').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const meds = pgTable('meds', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  patientName: text('patient_name').notNull(),
  name: text('name').notNull(),
  dose: text('dose').notNull().default(''),
  /** Local times "HH:MM" in the group timezone. */
  times: text('times').array().notNull(),
  startOn: text('start_on').notNull(),
  endOn: text('end_on'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const medDoses = pgTable(
  'med_doses',
  {
    id: text('id').primaryKey(),
    medId: text('med_id')
      .notNull()
      .references(() => meds.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    scheduledAt: ts('scheduled_at').notNull(),
    givenAt: ts('given_at'),
    givenBy: text('given_by'),
    skipped: boolean('skipped').notNull().default(false),
  },
  (t) => [uniqueIndex('med_doses_med_time_uq').on(t.medId, t.scheduledAt)],
);

// ── v2.0 Money & more groups ──────────────────────────────────────────────────
export const dues = pgTable('dues', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  amountMinor: money('amount_minor').notNull(),
  /** monthly | once */
  period: text('period').notNull(),
  dueDay: integer('due_day').notNull().default(1),
  /** Empty = every adult member. v5.6 adds unit-based dues. */
  memberIds: text('member_ids').array().notNull().default(sql`'{}'::text[]`),
  unitBased: boolean('unit_based').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const dueCharges = pgTable(
  'due_charges',
  {
    id: text('id').primaryKey(),
    dueId: text('due_id')
      .notNull()
      .references(() => dues.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    /** a member, or (v5.6) a unit id */
    payerKey: text('payer_key').notNull(),
    periodKey: text('period_key').notNull(),
    amountMinor: money('amount_minor').notNull(),
    reportedAt: ts('reported_at'),
    paidAt: ts('paid_at'),
    confirmedBy: text('confirmed_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('due_charges_uq').on(t.dueId, t.payerKey, t.periodKey)],
);

export const budgets = pgTable('budgets', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  amountMinor: money('amount_minor').notNull(),
  /** month | total */
  period: text('period').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

/** One row per (budget, period, threshold): an alert can only ever be sent once. */
export const budgetAlerts = pgTable(
  'budget_alerts',
  {
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    periodKey: text('period_key').notNull(),
    threshold: integer('threshold').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.periodKey, t.threshold] })],
);

export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('other'),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

/** Event guest list: people without the app RSVP through their own guest link. */
export const invitees = pgTable('invitees', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  maxPlusOnes: integer('max_plus_ones').notNull().default(0),
  /** invited | going | maybe | no */
  status: text('status').notNull().default('invited'),
  plusOnes: integer('plus_ones').notNull().default(0),
  dietary: text('dietary'),
  respondedAt: ts('responded_at'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

// ── v2.2 Gam'eya (rotating savings). Tracking only: the app never holds the pot (A12). ─────────────
export const gameyas = pgTable('gameyas', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** each member pays this every month; the pot is amount × members */
  amountMinor: money('amount_minor').notNull(),
  /** 'YYYY-MM' of the first payout */
  startMonth: text('start_month').notNull(),
  dueDay: integer('due_day').notNull().default(1),
  /** agreed | drawn */
  orderMode: text('order_mode').notNull(),
  /** active | done | cancelled */
  status: text('status').notNull().default('active'),
  /** a group can run the same circle again: round 2 is a new gameya with previousId set */
  round: integer('round').notNull().default(1),
  previousId: text('previous_id'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

/** One slot per month. A member holds exactly one slot per round (unique index), so they receive the pot exactly once. */
export const gameyaSlots = pgTable(
  'gameya_slots',
  {
    gameyaId: text('gameya_id')
      .notNull()
      .references(() => gameyas.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    /** 1-based month number in the round */
    position: integer('position').notNull(),
    userId: text('user_id').notNull(),
    /** the receiver confirmed they got the whole pot */
    receivedAt: ts('received_at'),
  },
  (t) => [primaryKey({ columns: [t.gameyaId, t.position] }), uniqueIndex('gameya_slots_user_uq').on(t.gameyaId, t.userId)],
);

export const gameyaPayments = pgTable(
  'gameya_payments',
  {
    id: text('id').primaryKey(),
    gameyaId: text('gameya_id')
      .notNull()
      .references(() => gameyas.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    position: integer('position').notNull(),
    payerId: text('payer_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    dueAt: ts('due_at').notNull(),
    reportedAt: ts('reported_at'),
    /** set by that month's receiver (their own share is confirmed at once: it never leaves their hands) */
    confirmedAt: ts('confirmed_at'),
    confirmedBy: text('confirmed_by'),
  },
  (t) => [uniqueIndex('gameya_payments_uq').on(t.gameyaId, t.position, t.payerId)],
);

export const gameyaSwaps = pgTable('gameya_swaps', {
  id: text('id').primaryKey(),
  gameyaId: text('gameya_id')
    .notNull()
    .references(() => gameyas.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  requesterId: text('requester_id').notNull(),
  otherId: text('other_id').notNull(),
  otherAcceptedAt: ts('other_accepted_at'),
  organizerId: text('organizer_id'),
  organizerApprovedAt: ts('organizer_approved_at'),
  /** pending | done | rejected | cancelled */
  status: text('status').notNull().default('pending'),
  createdAt: createdAt(),
  doneAt: ts('done_at'),
});

/**
 * v2.4 plans. Rows are written only by the admin CLI (scripts/grant-entitlement.ts) — no HTTP route inserts or updates
 * them (B4, B9 v2.4). Store purchases (RevenueCat) will write here through a verified server-to-server webhook later.
 */
export const entitlements = pgTable(
  'entitlements',
  {
    id: text('id').primaryKey(),
    /** user | group */
    scope: text('scope').notNull(),
    /** a user id or a group id */
    subjectId: text('subject_id').notNull(),
    plan: text('plan').notNull(),
    /** admin | revenuecat | referral */
    source: text('source').notNull(),
    note: text('note'),
    grantedBy: text('granted_by').notNull(),
    startsAt: ts('starts_at').notNull(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('entitlements_subject_idx').on(t.scope, t.subjectId)],
);

// ── v2.6 payments through a gateway (the app never holds the money; A12 stage 2) ─────────────
export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    payerId: text('payer_id').notNull(),
    payeeId: text('payee_id').notNull(),
    /** due | settlement | gameya */
    purpose: text('purpose').notNull(),
    /** due charge id, payee user id (settlement) or gam'eya payment id */
    targetId: text('target_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    feeMinor: money('fee_minor').notNull(),
    totalMinor: money('total_minor').notNull(),
    currency: text('currency').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    /** created | succeeded | failed */
    status: text('status').notNull().default('created'),
    failureCode: text('failure_code'),
    createdAt: createdAt(),
    paidAt: ts('paid_at'),
  },
  (t) => [uniqueIndex('payments_provider_ref_uq').on(t.provider, t.providerRef), index('payments_group_idx').on(t.groupId)],
);

/** Every webhook we accepted. The unique (provider, event id) makes a duplicate delivery a no-op (B9 v2.6). */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
    paymentId: text('payment_id'),
    payload: jsonb('payload').notNull(),
    receivedAt: ts('received_at').notNull(),
  },
  (t) => [uniqueIndex('payment_events_uq').on(t.provider, t.providerEventId)],
);

export const receipts = pgTable('receipts', {
  id: text('id').primaryKey(),
  /** one receipt per payment */
  paymentId: text('payment_id')
    .notNull()
    .unique()
    .references(() => payments.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  seq: serial('seq').notNull(),
  number: text('number').notNull(),
  issuedAt: ts('issued_at').notNull(),
});

// ── v2.8 challenges ──────────────────────────────────────────────────────────
export const challenges = pgTable('challenges', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** split (khatma, book chapters) | tally (daily target with streaks) */
  kind: text('kind').notNull(),
  totalParts: integer('total_parts'),
  partLabel: text('part_label'),
  /** split: participants in rotation order */
  memberIds: text('member_ids').array().notNull().default(sql`'{}'::text[]`),
  round: integer('round').notNull().default(1),
  /** start the next round (rotated) as soon as every part is done */
  autoNext: boolean('auto_next').notNull().default(true),
  target: integer('target'),
  unit: text('unit'),
  /** active | archived */
  status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const challengeParts = pgTable(
  'challenge_parts',
  {
    challengeId: text('challenge_id')
      .notNull()
      .references(() => challenges.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    round: integer('round').notNull(),
    part: integer('part').notNull(),
    userId: text('user_id'),
    doneAt: ts('done_at'),
    doneBy: text('done_by'),
  },
  (t) => [primaryKey({ columns: [t.challengeId, t.round, t.part] })],
);

export const challengeLogs = pgTable(
  'challenge_logs',
  {
    challengeId: text('challenge_id')
      .notNull()
      .references(() => challenges.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    day: text('day').notNull(),
    value: integer('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.challengeId, t.userId, t.day] })],
);

// ── v2.8 forms & sign-offs ───────────────────────────────────────────────────
export const forms = pgTable('forms', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  fields: jsonb('fields').$type<import('@circle/shared').FormField[]>().notNull(),
  requireSignature: boolean('require_signature').notNull().default(false),
  /** empty = every member */
  memberIds: text('member_ids').array().notNull().default(sql`'{}'::text[]`),
  closesAt: ts('closes_at'),
  closedAt: ts('closed_at'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const formResponses = pgTable(
  'form_responses',
  {
    id: text('id').primaryKey(),
    formId: text('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    answers: jsonb('answers').$type<Record<string, string | number | boolean>>().notNull(),
    /** { path, width, height, name } — strokes in the pad's pixels, plus the typed name */
    signature: jsonb('signature').$type<import('@circle/shared').Signature | null>(),
    signedAt: ts('signed_at'),
    submittedAt: ts('submitted_at').notNull(),
  },
  (t) => [uniqueIndex('form_responses_uq').on(t.formId, t.userId)],
);

// ── v3.0 work pack ───────────────────────────────────────────────────────────
export const standups = pgTable(
  'standups',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    day: text('day').notNull(),
    yesterday: text('yesterday').notNull().default(''),
    today: text('today').notNull(),
    blockers: text('blockers').notNull().default(''),
    answeredAt: ts('answered_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId, t.day] })],
);

export const meetings = pgTable('meetings', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  day: text('day').notNull(),
  notes: text('notes').notNull().default(''),
  /** parsed from the notes; taskId once turned into a task */
  actionItems: jsonb('action_items').$type<{ title: string; assigneeId: string | null; dueDay: string | null; taskId: string | null }[]>().notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const leaves = pgTable('leaves', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  startDay: text('start_day').notNull(),
  endDay: text('end_day').notNull(),
  /** vacation | sick | other */
  kind: text('kind').notNull(),
  note: text('note'),
  /** pending | approved | rejected (Work Teams approve automatically; Company groups need a manager, v3.4) */
  status: text('status').notNull(),
  decidedBy: text('decided_by'),
  createdAt: createdAt(),
});

// ── v3.2 checklists (opening / closing every day, onboarding per new hire) ────
export const checklists = pgTable('checklists', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** opening | closing | onboarding | other */
  kind: text('kind').notNull(),
  items: jsonb('items').$type<{ id: string; text: string; photo: boolean }[]>().notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const checklistRuns = pgTable(
  'checklist_runs',
  {
    id: text('id').primaryKey(),
    checklistId: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    /** daily lists: the local day; onboarding: '' */
    day: text('day').notNull().default(''),
    /** onboarding: the new hire; daily lists: '' */
    subjectUserId: text('subject_user_id').notNull().default(''),
    checks: jsonb('checks').$type<Record<string, { at: string; by: string; photoFileId: string | null }>>().notNull().default({}),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('checklist_runs_uq').on(t.checklistId, t.day, t.subjectUserId)],
);

// ── v3.4 shifts, swaps, time clock ───────────────────────────────────────────
export const shifts = pgTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** null = an open shift anyone can ask for */
    userId: text('user_id'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    label: text('label').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('shifts_group_time_idx').on(t.groupId, t.startsAt)],
);

export const shiftSwaps = pgTable('shift_swaps', {
  id: text('id').primaryKey(),
  shiftId: text('shift_id')
    .notNull()
    .references(() => shifts.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  /** who asks: the shift's owner giving it away, or someone claiming an open shift */
  requesterId: text('requester_id').notNull(),
  /** who takes it (null = give it back as an open shift) */
  toUserId: text('to_user_id'),
  peerAcceptedAt: ts('peer_accepted_at'),
  /** pending | approved | rejected | cancelled */
  status: text('status').notNull().default('pending'),
  decidedBy: text('decided_by'),
  createdAt: createdAt(),
});

export const timeEntries = pgTable(
  'time_entries',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    shiftId: text('shift_id'),
    inAt: ts('in_at').notNull(),
    outAt: ts('out_at'),
    /** qr | manager */
    source: text('source').notNull(),
    closedBy: text('closed_by'),
  },
  (t) => [index('time_entries_group_idx').on(t.groupId, t.inAt)],
);

// ── v3.6 inventory, assets, spend approvals ──────────────────────────────────
export const inventoryItems = pgTable('inventory_items', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  unit: text('unit').notNull().default(''),
  quantity: integer('quantity').notNull().default(0),
  lowAt: integer('low_at').notNull().default(0),
  /** at or below lowAt since the last alert (re-armed when restocked above) */
  low: boolean('low').notNull().default(false),
  vendorUserId: text('vendor_user_id'),
  vendorContactId: text('vendor_contact_id'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const inventoryMoves = pgTable('inventory_moves', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  delta: integer('delta').notNull(),
  after: integer('after').notNull(),
  reason: text('reason'),
  userId: text('user_id').notNull(),
  at: ts('at').notNull(),
});

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  location: text('location').notNull().default(''),
  serial: text('serial').notNull().default(''),
  serviceEveryDays: integer('service_every_days'),
  lastServiceDay: text('last_service_day'),
  nextServiceDay: text('next_service_day'),
  vendorContactId: text('vendor_contact_id'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const assetServices = pgTable('asset_services', {
  id: text('id').primaryKey(),
  assetId: text('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull(),
  day: text('day').notNull(),
  note: text('note').notNull().default(''),
  costMinor: money('cost_minor').notNull().default(0),
  userId: text('user_id').notNull(),
  createdAt: createdAt(),
});

export const spendRequests = pgTable('spend_requests', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  requesterId: text('requester_id').notNull(),
  title: text('title').notNull(),
  amountMinor: money('amount_minor').notNull(),
  category: text('category').notNull().default(''),
  note: text('note'),
  /** pending | approved | rejected */
  status: text('status').notNull(),
  /** 'auto' when within the requester's own limit */
  decidedBy: text('decided_by'),
  decidedAt: ts('decided_at'),
  createdAt: createdAt(),
});
