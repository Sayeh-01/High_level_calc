import { z } from 'zod';
import { formField, signatureInput } from './forms';
import { PERMISSIONS, type Permission } from './permissions';
import { isValidRRule } from './recurrence';
import { isValidTimeZone } from './time';

export const id = z.string().min(1).max(64);
export const isoDate = z.iso.datetime({ offset: true });
export const minor = z.number().int().safe();
export const rrule = z.string().max(200).refine(isValidRRule, 'unsupported recurrence rule');
export const timezone = z.string().refine(isValidTimeZone, 'unknown timezone');
export const lang = z.enum(['en', 'ar']);
export const digits = z.enum(['latn', 'arab']);

export const profileUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  image: z.string().max(500).nullable().optional(),
  language: lang.optional(),
  digits: digits.optional(),
  timezone: timezone.optional(),
});

export const groupCreate = z.object({
  templateId: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  emoji: z.string().max(16).optional(),
  color: z.string().max(16).optional(),
  currency: z.string().length(3).optional(),
  timezone: timezone.optional(),
  modules: z.array(z.string().max(40)).max(60).optional(),
  lang: lang.default('en'),
});

export const groupUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  emoji: z.string().max(16).optional(),
  color: z.string().max(16).optional(),
  photo: z.string().max(500).nullable().optional(),
  membersCanInvite: z.boolean().optional(),
  timezone: timezone.optional(),
});

export const modulesUpdate = z.object({ modules: z.array(z.string().max(40)).max(60) });
export const joinGroup = z.object({ code: z.string().trim().min(4).max(32), displayName: z.string().trim().max(60).optional() });
export const memberUpdate = z.object({
  role: z.enum(['admin', 'manager', 'member', 'child']).optional(),
  customRoleId: z.string().max(40).nullable().optional(),
  displayName: z.string().trim().min(1).max(60).optional(),
  away: z.boolean().optional(),
});
export const transferOwnership = z.object({ userId: id });

export const taskCreate = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).optional(),
  assigneeId: id.nullable().optional(),
  rotation: z.array(id).max(50).optional(),
  dueAt: isoDate.nullable().optional(),
  rrule: rrule.nullable().optional(),
  points: z.number().int().min(0).max(1000).optional(),
});
export const taskUpdate = taskCreate.partial();
export const taskComplete = z.object({ photoFileId: id.optional() });
export const commentCreate = z.object({ body: z.string().trim().min(1).max(2000) });

export const eventCreate = z.object({
  title: z.string().trim().min(1).max(200),
  startsAt: isoDate,
  endsAt: isoDate.nullable().optional(),
  rrule: rrule.nullable().optional(),
  location: z.string().max(200).optional(),
  capacity: z.number().int().min(1).max(10000).nullable().optional(),
  waitlist: z.boolean().optional(),
  reminderMin: z.number().int().min(0).max(10080).nullable().optional(),
  notes: z.string().max(4000).optional(),
});
export const eventUpdate = eventCreate.partial();
export const rsvp = z.object({ status: z.enum(['going', 'maybe', 'no']) });
export const splitEvent = z.object({ amount: minor.positive(), title: z.string().max(200).optional(), payerId: id.optional() });

export const listCreate = z.object({ title: z.string().trim().min(1).max(120) });
export const listItemCreate = z.object({
  title: z.string().trim().min(1).max(200),
  qty: z.string().max(20).optional(),
  category: z.string().max(40).optional(),
});
export const listItemUpdate = listItemCreate.partial().extend({ checked: z.boolean().optional() });

export const splitInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('equal'), members: z.array(id).min(1) }),
  z.object({ kind: z.literal('exact'), amounts: z.record(z.string(), minor) }),
  z.object({ kind: z.literal('shares'), shares: z.record(z.string(), z.number().nonnegative()) }),
  z.object({ kind: z.literal('percent'), percents: z.record(z.string(), z.number().nonnegative()) }),
]);
export const expenseCreate = z.object({
  title: z.string().trim().min(1).max(200),
  amount: minor.positive(),
  payerId: id,
  split: splitInput,
  eventId: id.optional(),
  spentAt: isoDate.optional(),
  currency: z.string().length(3).optional(),
  rate: z.number().positive().optional(),
  category: z.string().max(40).optional(),
});
export const settlementCreate = z.object({
  toId: id,
  amount: minor.positive(),
  method: z.enum(['cash', 'bank', 'wallet', 'other']),
  note: z.string().max(200).optional(),
});

export const pollCreate = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(20),
  multi: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  closesAt: isoDate.nullable().optional(),
});
export const pollVote = z.object({ optionIds: z.array(id).min(1).max(20) });

export const messageCreate = z.object({
  body: z.string().max(4000).default(''),
  imageFileId: id.optional(),
  audioFileId: id.optional(),
  audioMs: z.number().int().min(0).max(15 * 60_000).optional(),
  replyToId: id.optional(),
  mentions: z.array(id).max(50).optional(),
  pinned: z.boolean().optional(),
});

export const pushTokenRegister = z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web']) });

export type GroupCreate = z.infer<typeof groupCreate>;
export type TaskCreate = z.infer<typeof taskCreate>;
export type EventCreate = z.infer<typeof eventCreate>;
export type ExpenseCreate = z.infer<typeof expenseCreate>;
export type PollCreate = z.infer<typeof pollCreate>;

export const rewardCreate = z.object({ title: z.string().trim().min(1).max(120), cost: z.number().int().min(1).max(100000), emoji: z.string().max(16).optional() });
export const pointsAdjust = z.object({ userId: id, delta: z.number().int().min(-100000).max(100000), note: z.string().max(200).optional() });
export const childCreate = z.object({ name: z.string().trim().min(1).max(60), pin: z.string().regex(/^\d{4,6}$/) });
export const childPin = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

export const skillSet = z.object({ skill: z.number().min(0).max(10) });
export const motmVote = z.object({ nomineeId: id });
export const carpoolOffer = z.object({ seats: z.number().int().min(1).max(12), note: z.string().max(200).optional() });
export const countdownCreate = z.object({ title: z.string().trim().min(1).max(120), at: isoDate });
export const deckCreate = z.object({ title: z.string().trim().min(1).max(120) });
export const cardCreate = z.object({ front: z.string().trim().min(1).max(1000), back: z.string().trim().min(1).max(2000) });
export const cardReview = z.object({ grade: z.number().int().min(0).max(5) });
export const pageUpsert = z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(50_000).default('') });

export const ingredient = z.object({ name: z.string().trim().min(1).max(80), qty: z.number().nonnegative().max(100000).nullable().optional(), unit: z.string().max(20).nullable().optional() });
export const mealCreate = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  title: z.string().trim().min(1).max(120),
  ingredients: z.array(ingredient).max(60).default([]),
});
export const mealsToList = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), listId: id.optional() });
export const memoryCreate = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().trim().max(4000).default(''), photoFileIds: z.array(id).max(10).default([]) });
export const aiCapture = z.object({ text: z.string().trim().min(1).max(500) });
export const aiQuiz = z.object({ pageId: id.optional(), text: z.string().max(20000).optional(), count: z.number().int().min(1).max(30).default(10) });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const folderCreate = z.object({ name: z.string().trim().min(1).max(80), access: z.enum(['all', 'admins', 'custom']).default('all'), memberIds: z.array(id).max(100).default([]) });
export const vaultDocCreate = z.object({ title: z.string().trim().min(1).max(160), fileId: id.optional(), expiresOn: day.nullable().optional(), notes: z.string().max(4000).optional() });
export const vaultDocUpdate = vaultDocCreate.partial();
export const emergencyCard = z.object({
  bloodType: z.string().max(5).optional(),
  allergies: z.string().max(500).optional(),
  conditions: z.string().max(500).optional(),
  medications: z.string().max(500).optional(),
  doctors: z.string().max(500).optional(),
  insurance: z.string().max(300).optional(),
  contacts: z.array(z.object({ name: z.string().max(60), phone: z.string().max(30) })).max(5).default([]),
});
export const medCreate = z.object({
  patientName: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  dose: z.string().max(60).default(''),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(8),
  startOn: day,
  endOn: day.nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export const safetyPing = z.object({ note: z.string().max(200).optional() });

export const dueCreate = z.object({ title: z.string().trim().min(1).max(120), amount: minor.positive(), period: z.enum(['monthly', 'once']).default('monthly'), dueDay: z.number().int().min(1).max(28).default(1), memberIds: z.array(id).max(500).optional() });
export const budgetCreate = z.object({ category: z.string().trim().min(1).max(40), amount: minor.positive(), period: z.enum(['month', 'total']).default('month') });
export const contactCreate = z.object({ name: z.string().trim().min(1).max(80), kind: z.string().max(40).default('other'), phone: z.string().max(30).optional(), email: z.string().max(120).optional(), notes: z.string().max(500).optional() });
export const guestCreate = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().max(30).optional(), maxPlusOnes: z.number().int().min(0).max(10).default(0) });
export const guestRsvp = z.object({ status: z.enum(['going', 'maybe', 'no']), plusOnes: z.number().int().min(0).max(10).default(0), dietary: z.string().max(200).optional() });
export const aiReceipt = z.object({ fileId: id });

// v2.2 gam'eya
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const gameyaCreate = z.object({
  title: z.string().trim().min(1).max(80),
  amount: minor.positive(),
  startMonth: month,
  dueDay: z.number().int().min(1).max(28).default(1),
  orderMode: z.enum(['agreed', 'drawn']),
  /** for 'agreed', this is the payout order */
  memberIds: z.array(id).min(2).max(60),
});
export const gameyaSwapCreate = z.object({ otherId: id });

// v2.6 payments: the client names what it pays for; the server works out the amount
export const paymentCreate = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('due'), targetId: id }),
  z.object({ purpose: z.literal('gameya'), targetId: id }),
  z.object({ purpose: z.literal('settlement'), targetId: id, amount: minor.positive() }),
]);

// v2.8 challenges + forms
export const challengeCreate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('split'), title: z.string().trim().min(1).max(80), totalParts: z.number().int().min(1).max(604), partLabel: z.string().trim().min(1).max(30).default('Part'), memberIds: z.array(id).min(1).max(200), autoNext: z.boolean().default(true) }),
  z.object({ kind: z.literal('tally'), title: z.string().trim().min(1).max(80), target: z.number().int().positive().max(1_000_000), unit: z.string().trim().max(20).default('') }),
]);
export const challengeLog = z.object({ value: z.number().int().min(0).max(1_000_000), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const partAssign = z.object({ userId: id.nullable() });
export const formCreate = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  fields: z.array(formField).max(30),
  requireSignature: z.boolean().default(false),
  /** empty = every member */
  memberIds: z.array(id).max(500).default([]),
  closesAt: isoDate.nullable().optional(),
});
export const formRespond = z.object({ answers: z.record(z.string(), z.unknown()).default({}), signature: signatureInput.optional() });

// v3.0 work pack
export const taskStage = z.object({ stage: z.enum(['todo', 'doing']) });
export const standupAnswer = z.object({ yesterday: z.string().trim().max(1000).default(''), today: z.string().trim().min(1).max(1000), blockers: z.string().trim().max(1000).default('') });
export const meetingCreate = z.object({ title: z.string().trim().min(1).max(120), day, notes: z.string().max(20000).default('') });
export const meetingUpdate = z.object({ title: z.string().trim().min(1).max(120).optional(), notes: z.string().max(20000).optional() });
export const leaveCreate = z.object({ startDay: day, endDay: day, kind: z.enum(['vacation', 'sick', 'other']).default('vacation'), note: z.string().max(300).optional() });

// v3.2 company
const permission = z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]]);
export const customRoleDef = z.object({
  name: z.string().trim().min(1).max(40),
  base: z.enum(['admin', 'manager', 'member', 'vendor']),
  grant: z.array(permission).max(30).default([]),
  deny: z.array(permission).max(30).default([]),
});
export const subgroupCreate = z.object({ name: z.string().trim().min(1).max(80), emoji: z.string().max(16).optional(), memberIds: z.array(id).max(500).default([]) });
export const checklistCreate = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(['opening', 'closing', 'onboarding', 'other']),
  items: z.array(z.object({ text: z.string().trim().min(1).max(200), photo: z.boolean().default(false) })).min(1).max(60),
});
export const checklistCheck = z.object({ photoFileId: id.optional() });

// v3.4 shifts + clock
export const shiftCreate = z.object({ userId: id.nullable(), startsAt: isoDate, endsAt: isoDate, label: z.string().trim().max(60).default(''), repeatWeeks: z.number().int().min(1).max(12).default(1) });
export const shiftSwapCreate = z.object({ toUserId: id.nullable() });
export const clockPunch = z.object({ code: z.string().regex(/^\d{6}$/) });
export const clockClose = z.object({ outAt: isoDate });

// v3.6 operations
export const inventoryCreate = z.object({ name: z.string().trim().min(1).max(80), unit: z.string().trim().max(20).default(''), quantity: z.number().int().min(0).max(1_000_000).default(0), lowAt: z.number().int().min(0).max(1_000_000).default(0), vendorUserId: id.nullable().optional(), vendorContactId: id.nullable().optional() });
export const inventoryMove = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((d) => d !== 0), reason: z.string().trim().max(120).optional() });
export const inventoryCount = z.object({ quantity: z.number().int().min(0).max(1_000_000) });
export const reorder = z.object({ quantity: z.number().int().positive().max(1_000_000) });
export const assetCreate = z.object({ name: z.string().trim().min(1).max(80), location: z.string().trim().max(80).default(''), serial: z.string().trim().max(80).default(''), serviceEveryDays: z.number().int().min(1).max(3650).nullable().default(null), lastServiceDay: day.nullable().optional(), vendorContactId: id.nullable().optional() });
export const assetService = z.object({ note: z.string().trim().max(500).default(''), costMinor: minor.nonnegative().default(0), day: day.optional() });
export const spendRequest = z.object({ title: z.string().trim().min(1).max(120), amount: minor.positive(), category: z.string().trim().max(40).default(''), note: z.string().max(500).optional() });
export const approvalLimits = z.object({ limits: z.record(z.string().regex(/^[a-z0-9_-]{1,40}$/), minor.nonnegative()) });
