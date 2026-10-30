// Work Team pack (v3.0): meeting notes → action items, stand-up work days, leave ranges.

export interface ActionItem {
  title: string;
  assigneeId: string | null;
  dueDay: string | null;
}

const ITEM = /^\s*(?:[-*•]\s*)?(?:\[\s\]|TODO:|AI:)\s*(.+)$/i;

/** Lines like "- [ ] Send the deck @Amal by 2026-11-10", "TODO: …" or "AI: …" become action items. */
export function parseActionItems(notes: string, members: { userId: string; displayName: string }[]): ActionItem[] {
  const out: ActionItem[] = [];
  for (const line of notes.split('\n')) {
    const m = ITEM.exec(line);
    if (!m) continue;
    let text = m[1].trim();
    let dueDay: string | null = null;
    const due = /\s+(?:by|due|قبل|لحد)\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
    if (due) {
      dueDay = due[1];
      text = text.slice(0, due.index).trim();
    }
    let assigneeId: string | null = null;
    const at = /\s@(\S+)\s*$/.exec(` ${text}`);
    if (at) {
      const who = at[1].toLowerCase();
      const hit = members.find((x) => x.displayName.toLowerCase().split(/\s+/)[0] === who || x.displayName.toLowerCase().replace(/\s+/g, '') === who);
      if (hit) {
        assigneeId = hit.userId;
        text = text.slice(0, Math.max(0, at.index - 1)).trim();
      }
    }
    if (text) out.push({ title: text.slice(0, 200), assigneeId, dueDay });
  }
  return out;
}

/** 0 = Sunday. Egypt and Saudi Arabia work Sunday–Thursday. */
export function defaultWorkDays(tz: string): number[] {
  return ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain'].includes(tz) ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
}

export function isWorkDay(dayKey: string, workDays: number[]): boolean {
  const [y, m, d] = dayKey.split('-').map(Number);
  return workDays.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

export function leaveOverlaps(a: { startDay: string; endDay: string }, b: { startDay: string; endDay: string }): boolean {
  return a.startDay <= b.endDay && b.startDay <= a.endDay;
}
