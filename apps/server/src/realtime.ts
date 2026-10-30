import { createNodeWebSocket } from '@hono/node-ws';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BusMessage } from './bus';
import { groupMembers } from './db/schema';
import type { Deps } from './deps';

// The server only says "group X, entity Y changed"; clients refetch. Chat messages and presence carry payloads.

export function signTicket(secret: string, userId: string, expires: number) {
  const sig = createHmac('sha256', secret).update(`ws.${userId}.${expires}`).digest('base64url');
  return `${userId}.${expires}.${sig}`;
}

export function verifyTicket(secret: string, ticket: string, now: number): string | null {
  const [userId, exp, sig] = ticket.split('.');
  if (!userId || !exp || !sig) return null;
  const expected = createHmac('sha256', secret).update(`ws.${userId}.${exp}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected) || Number(exp) < now) return null;
  return userId;
}

/** Presence rooms (focus rooms, "who's online"): room key = `${groupId}:${room}`. */
export class Presence {
  private rooms = new Map<string, Map<string, number>>();
  join(groupId: string, room: string, userId: string) {
    const key = `${groupId}:${room}`;
    let m = this.rooms.get(key);
    if (!m) this.rooms.set(key, (m = new Map()));
    m.set(userId, (m.get(userId) ?? 0) + 1);
    return this.users(groupId, room);
  }
  leave(groupId: string, room: string, userId: string) {
    const key = `${groupId}:${room}`;
    const m = this.rooms.get(key);
    if (!m) return [];
    const n = (m.get(userId) ?? 0) - 1;
    if (n <= 0) m.delete(userId);
    else m.set(userId, n);
    if (m.size === 0) this.rooms.delete(key);
    return this.users(groupId, room);
  }
  users(groupId: string, room: string) {
    return [...(this.rooms.get(`${groupId}:${room}`)?.keys() ?? [])];
  }
}

export function attachRealtime(app: Hono<any>, deps: Deps) {
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  const presence = new Presence();

  app.get(
    '/api/ws',
    upgradeWebSocket((c) => {
      const userId = verifyTicket(deps.env.authSecret, c.req.query('ticket') ?? '', deps.clock().getTime());
      const unsubs = new Map<string, () => void>();
      const joined = new Set<string>();
      let unsubUser: (() => void) | null = null;
      let send: (msg: BusMessage | Record<string, unknown>) => void = () => {};

      async function syncGroups() {
        if (!userId) return;
        const rows = await deps.db.select({ g: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId));
        const now = new Set(rows.map((r) => r.g));
        for (const [g, off] of unsubs) if (!now.has(g)) (off(), unsubs.delete(g));
        for (const g of now) if (!unsubs.has(g)) unsubs.set(g, deps.bus.subscribeGroup(g, (m) => send(m)));
      }

      return {
        async onOpen(_evt, ws) {
          if (!userId) {
            ws.close(4401, 'unauthenticated');
            return;
          }
          send = (m) => {
            try {
              ws.send(JSON.stringify(m));
            } catch {}
          };
          unsubUser = deps.bus.subscribeUser(userId, async (m) => {
            send(m);
            if (m.type === 'membership') await syncGroups();
          });
          await syncGroups();
          send({ type: 'ready' });
        },
        async onMessage(evt) {
          if (!userId) return;
          let msg: any;
          try {
            msg = JSON.parse(String(evt.data));
          } catch {
            return;
          }
          if (msg?.type === 'presence' && typeof msg.groupId === 'string' && typeof msg.room === 'string') {
            if (!unsubs.has(msg.groupId)) return; // not a member
            const key = `${msg.groupId}:${msg.room}`;
            const users = msg.action === 'leave' ? (joined.delete(key), presence.leave(msg.groupId, msg.room, userId)) : (joined.add(key), presence.join(msg.groupId, msg.room, userId));
            deps.bus.publish({ type: 'presence', groupId: msg.groupId, room: msg.room, users });
          }
        },
        onClose() {
          for (const off of unsubs.values()) off();
          unsubUser?.();
          for (const key of joined) {
            const [groupId, room] = key.split(':');
            deps.bus.publish({ type: 'presence', groupId, room, users: presence.leave(groupId, room, userId!) });
          }
        },
      };
    }),
  );
  return { injectWebSocket, presence };
}
