import { createHmac } from 'node:crypto';

// Time clock (v3.4). The clock-in code is TOTP-like: HMAC(group key, 30-second window) → 6 digits. A code is accepted in its
// own window and the next one, so it is never older than 60 seconds (B9 v3.x). Shown as a QR by a manager; typed on web.

export const CLOCK_WINDOW_MS = 30_000;

export function clockCode(key: string, now: number): string {
  const window = Math.floor(now / CLOCK_WINDOW_MS);
  const h = createHmac('sha256', key).update(String(window)).digest('hex');
  return String(parseInt(h.slice(0, 8), 16) % 1_000_000).padStart(6, '0');
}

export function clockCodeValid(key: string, code: string, now: number): boolean {
  return [now, now - CLOCK_WINDOW_MS].some((t) => clockCode(key, t) === code);
}
