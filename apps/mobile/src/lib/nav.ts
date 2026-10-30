/** Where a notification should open. */
export function hrefFor(n: { groupId: string | null; data?: Record<string, any> }): string | null {
  const g = n.groupId;
  const d = n.data ?? {};
  if (d.href) return d.href;
  if (!g) return null;
  if (d.taskId) return `/g/${g}/task/${d.taskId}`;
  if (d.eventId) return `/g/${g}/event/${d.eventId}`;
  if (d.settlementId || d.expenseId) return `/g/${g}/expenses`;
  if (d.messageId) return `/g/${g}/chat`;
  if (d.pollId) return `/g/${g}/polls`;
  return `/g/${g}`;
}
