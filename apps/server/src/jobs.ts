import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { jobs, notifications, pushTokens } from './db/schema';
import type { Deps } from './deps';
import { enqueueJob } from './effects';
import type { PushMessage } from './push';

// Our own Postgres job table instead of pg-boss: pg-boss needs a TCP Postgres connection, and the whole suite must run
// in-process on PGlite (see docs/NOTES.md). Every job carries an absolute run_at computed in the group's timezone.

export type JobHandler = (deps: Deps, payload: Record<string, any>, job: typeof jobs.$inferSelect) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJob(kind: string, handler: JobHandler) {
  handlers.set(kind, handler);
}

export const MAX_ATTEMPTS = 5;
export const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1));

/** Runs due jobs one by one. Returns how many ran. Tests call it with a fake clock. */
export async function runDueJobs(deps: Deps, now: Date = deps.clock(), limit = 100): Promise<number> {
  const due = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
    .orderBy(asc(jobs.runAt))
    .limit(limit);
  let ran = 0;
  for (const job of due) {
    const handler = handlers.get(job.kind);
    // claim it so a concurrent runner skips it
    const claimed = await deps.db
      .update(jobs)
      .set({ status: 'running', attempts: job.attempts + 1 })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'pending')))
      .returning({ id: jobs.id });
    if (claimed.length === 0) continue;
    try {
      if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
      await handler(deps, job.payload as Record<string, any>, job);
      await deps.db.update(jobs).set({ status: 'done', doneAt: now }).where(eq(jobs.id, job.id));
    } catch (err) {
      const attempts = job.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await deps.db
        .update(jobs)
        .set({
          status: dead ? 'dead' : 'pending',
          lastError: String((err as Error)?.message ?? err).slice(0, 500),
          runAt: new Date(now.getTime() + backoffMs(attempts)),
        })
        .where(eq(jobs.id, job.id));
    }
    ran++;
  }
  return ran;
}

export function startJobLoop(deps: Deps, intervalMs = 15_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while ((await runDueJobs(deps)) > 0) {}
    } catch (e) {
      console.error('[jobs]', e);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// ── push pipeline: notifications row → push job → Expo, pruning invalid tokens ──────────────
registerJob('push', async (deps, payload) => {
  const ids: string[] = payload.notificationIds ?? [];
  if (ids.length === 0) return;
  const rows = await deps.db.select().from(notifications).where(inArray(notifications.id, ids));
  const userIds = [...new Set(rows.map((r) => r.userId))];
  if (userIds.length === 0) return;
  const tokens = await deps.db.select().from(pushTokens).where(inArray(pushTokens.userId, userIds));
  const messages: PushMessage[] = [];
  for (const n of rows) {
    for (const t of tokens.filter((t) => t.userId === n.userId)) {
      messages.push({
        to: t.token,
        title: n.title,
        body: n.body,
        sound: 'default',
        data: { ...n.data, notificationId: n.id, groupId: n.groupId, kind: n.kind },
        categoryId: (n.data as any)?.category,
      });
    }
  }
  if (messages.length === 0) return;
  const result = await deps.push.send(messages);
  await pruneTokens(deps, result.invalidTokens);
  if (result.ticketIds.length) {
    await enqueueJob(deps.db, {
      kind: 'push_receipts',
      payload: { tickets: result.ticketIds },
      runAt: new Date(deps.clock().getTime() + 15 * 60_000),
    });
  }
});

registerJob('push_receipts', async (deps, payload) => {
  const { invalidTokens } = await deps.push.receipts(payload.tickets ?? []);
  await pruneTokens(deps, invalidTokens);
});

export async function pruneTokens(deps: Deps, tokens: string[]) {
  if (tokens.length) await deps.db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
}
