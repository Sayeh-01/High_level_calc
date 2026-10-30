import { AppState } from 'react-native';
import { post } from './api';
import { API_URL } from './config';
import { queryClient } from './query';

type Listener = (msg: any) => void;

/** One socket per signed-in app. The server says "group X, entity Y changed"; we invalidate and refetch. */
class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stopped = true;
  private retry = 0;
  private outbox: string[] = [];

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    AppState.addEventListener('change', (s) => {
      if (s === 'active' && !this.stopped && (!this.ws || this.ws.readyState > 1)) this.connect();
    });
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  send(msg: unknown) {
    const s = JSON.stringify(msg);
    if (this.ws?.readyState === 1) this.ws.send(s);
    else this.outbox.push(s);
  }

  private async connect() {
    try {
      const { ticket } = await post<{ ticket: string }>('/ws-ticket');
      const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`);
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        for (const m of this.outbox.splice(0)) ws.send(m);
      };
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        handle(msg);
        for (const fn of this.listeners) fn(msg);
      };
      ws.onclose = () => this.scheduleReconnect();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.retry++;
    setTimeout(() => !this.stopped && this.connect(), Math.min(30_000, 1000 * 2 ** this.retry));
  }
}

function handle(msg: any) {
  // (re)connected: anything could have changed while we were away
  if (msg.type === 'ready') queryClient.invalidateQueries();
  if (msg.type === 'invalidate' || msg.type === 'message') {
    queryClient.invalidateQueries({ queryKey: ['group', msg.groupId] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
  }
  if (msg.type === 'membership') {
    // removed members lose the group right away (B7 #15)
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
    queryClient.removeQueries({ queryKey: ['group', msg.groupId] });
  }
}

export const realtime = new Realtime();
