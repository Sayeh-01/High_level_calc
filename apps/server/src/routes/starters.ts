import { fromZoned, nextOccurrence, toZoned, type Lang, type Template } from '@circle/shared';
import type { DbOrTx } from '../db/client';
import { events, listItems, lists, tasks } from '../db/schema';
import { newId } from '../ids';
import { materializeSeries } from '../services/events';

function localTodayAt(now: Date, tz: string, hhmm: string) {
  const z = toZoned(now.getTime(), tz);
  const [h, m] = hhmm.split(':').map(Number);
  return fromZoned({ year: z.year, month: z.month, day: z.day, hour: h, minute: m }, tz);
}

/** Never show an empty screen: each template seeds its modules with starter items (A13). */
export async function createStarterContent(
  tx: DbOrTx,
  a: { groupId: string; template: Template; modules: string[]; userId: string; tz: string; lang: Lang; now: Date },
) {
  const { template: t, lang } = a;
  if (a.modules.includes('lists')) {
    for (const l of t.starters.lists ?? []) {
      const listId = newId();
      await tx.insert(lists).values({ id: listId, groupId: a.groupId, title: l.title[lang], createdBy: a.userId });
      const items = (l.items ?? []).map((it, i) => ({ id: newId(), listId, groupId: a.groupId, title: it[lang], position: i, createdBy: a.userId }));
      if (items.length) await tx.insert(listItems).values(items);
    }
  }
  if (a.modules.includes('events')) {
    for (const e of t.starters.events ?? []) {
      const start = localTodayAt(a.now, a.tz, e.time) + (e.inDays ?? 0) * 86_400_000;
      const id = newId();
      const row = {
        id,
        groupId: a.groupId,
        title: e.title[lang],
        startsAt: new Date(start),
        endsAt: e.durationMin ? new Date(start + e.durationMin * 60_000) : null,
        rrule: e.rrule ?? null,
        tz: a.tz,
        capacity: t.defaults.eventCapacity ?? null,
        waitlist: t.defaults.waitlist ?? false,
        reminderMin: 60,
        createdBy: a.userId,
      };
      const [master] = await tx.insert(events).values(row).returning();
      if (master.rrule) await materializeSeries(tx, master, a.now);
    }
  }
  if (a.modules.includes('tasks')) {
    for (const s of t.starters.tasks ?? []) {
      let due = localTodayAt(a.now, a.tz, '20:00');
      if (due <= a.now.getTime()) due += 86_400_000;
      if (s.rrule) {
        const next = nextOccurrence(s.rrule, due - 86_400_000, a.tz, a.now.getTime());
        if (next) due = next;
      }
      await tx.insert(tasks).values({
        id: newId(),
        groupId: a.groupId,
        title: s.title[lang],
        assigneeId: a.userId,
        rotation: s.rotation ? [a.userId] : null,
        dueAt: new Date(due),
        rrule: s.rrule ?? null,
        points: s.points ?? 0,
        createdBy: a.userId,
      });
    }
  }
}
