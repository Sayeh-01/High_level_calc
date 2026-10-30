import { eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from './db/client';
import { activity, groups, jobs, notifications } from './db/schema';
import { newId } from './ids';

/** Activity rows are written in the same transaction as the change they describe. */
export async function logActivity(
  tx: DbOrTx,
  a: { groupId: string; actorId: string | null; verb: string; entity: string; entityId?: string | null; summary?: string },
) {
  await tx.insert(activity).values({ id: newId(), groupId: a.groupId, actorId: a.actorId, verb: a.verb, entity: a.entity, entityId: a.entityId ?? null, summary: a.summary ?? '' });
  await tx.update(groups).set({ lastActivityAt: sql`now()` }).where(eq(groups.id, a.groupId));
}

export async function enqueueJob(
  tx: DbOrTx,
  j: { kind: string; payload?: Record<string, unknown>; runAt: Date; dedupeKey?: string },
) {
  await tx
    .insert(jobs)
    .values({ id: newId(), kind: j.kind, payload: j.payload ?? {}, runAt: j.runAt, dedupeKey: j.dedupeKey ?? null })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

export interface NotifyInput {
  userIds: string[];
  groupId: string | null;
  kind: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  /** Send a push now (default true). */
  push?: boolean;
  now: Date;
}

/** Inbox rows + a push job, inside the caller's transaction. The actor is never notified about their own action. */
export async function notify(tx: DbOrTx, n: NotifyInput & { exclude?: string | null }) {
  // guests (guest links) have no account, inbox or push token
  const userIds = [...new Set(n.userIds)].filter((u) => u && u !== n.exclude && !u.startsWith('guest:'));
  if (userIds.length === 0) return [];
  const rows = userIds.map((userId) => ({
    id: newId(),
    userId,
    groupId: n.groupId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? '',
    data: n.data ?? {},
  }));
  await tx.insert(notifications).values(rows);
  if (n.push !== false) {
    await enqueueJob(tx, { kind: 'push', payload: { notificationIds: rows.map((r) => r.id) }, runAt: n.now });
  }
  return rows.map((r) => r.id);
}

export async function markNotificationsRead(tx: DbOrTx, ids: string[]) {
  if (ids.length) await tx.update(notifications).set({ readAt: sql`now()` }).where(inArray(notifications.id, ids));
}
