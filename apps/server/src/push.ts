// Expo push over its HTTP API (no SDK): chunks of 100, prunes tokens Expo reports as DeviceNotRegistered.

export interface PushMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  categoryId?: string;
}

export interface PushResult {
  sent: number;
  invalidTokens: string[];
  ticketIds: { id: string; token: string }[];
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const PUSH_CHUNK = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isExpoPushToken(token: string) {
  return /^(Expo|Exponent)PushToken\[.+\]$/.test(token);
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult>;
  receipts(ticketIds: { id: string; token: string }[]): Promise<{ invalidTokens: string[] }>;
}

export function createExpoPushSender(fetchImpl: FetchLike = fetch as unknown as FetchLike, accessToken?: string): PushSender {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return {
    async send(messages) {
      const invalid = new Set<string>();
      const ticketIds: PushResult['ticketIds'] = [];
      const valid = messages.filter((m) => {
        if (isExpoPushToken(m.to)) return true;
        invalid.add(m.to);
        return false;
      });
      let sent = 0;
      for (const batch of chunk(valid, PUSH_CHUNK)) {
        const res = await fetchImpl(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(batch) });
        if (!res.ok) throw new Error(`expo push failed: HTTP ${res.status}`);
        const json = await res.json();
        const tickets: any[] = json.data ?? [];
        tickets.forEach((t, i) => {
          const token = batch[i]?.to;
          if (!token) return;
          if (t.status === 'ok') {
            sent++;
            if (t.id) ticketIds.push({ id: t.id, token });
          } else if (t.details?.error === 'DeviceNotRegistered') invalid.add(token);
        });
      }
      return { sent, invalidTokens: [...invalid], ticketIds };
    },
    async receipts(tickets) {
      const invalid = new Set<string>();
      const byId = new Map(tickets.map((t) => [t.id, t.token]));
      for (const batch of chunk(tickets, 1000)) {
        const res = await fetchImpl(EXPO_RECEIPTS_URL, { method: 'POST', headers, body: JSON.stringify({ ids: batch.map((t) => t.id) }) });
        if (!res.ok) throw new Error(`expo receipts failed: HTTP ${res.status}`);
        const json = await res.json();
        for (const [id, r] of Object.entries<any>(json.data ?? {})) {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
            const token = byId.get(id);
            if (token) invalid.add(token);
          }
        }
      }
      return { invalidTokens: [...invalid] };
    },
  };
}

/** Test/dev sender that records what would have been sent. */
export function createMemoryPushSender(): PushSender & { sent: PushMessage[] } {
  const sent: PushMessage[] = [];
  return {
    sent,
    async send(messages) {
      sent.push(...messages);
      return { sent: messages.length, invalidTokens: [], ticketIds: [] };
    },
    async receipts() {
      return { invalidTokens: [] };
    },
  };
}
