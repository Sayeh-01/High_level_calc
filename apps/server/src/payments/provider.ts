import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// PaymentProvider (B4). A real gateway (Paymob / Fawry / Stripe) implements this; the gateway collects from the payer and
// pays the payee, so Circle never holds money. Webhook verification uses the raw body — never re-serialized JSON.

export const webhookEvent = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  providerRef: z.string().min(1).max(100),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  failureCode: z.string().max(60).optional(),
});
export type WebhookEvent = z.infer<typeof webhookEvent>;

export interface PaymentProvider {
  id: string;
  createCheckout(a: { paymentId: string; amountMinor: number; currency: string; description: string; returnUrl: string }): Promise<{ providerRef: string; checkoutUrl: string }>;
  /** The event when the signature is valid and fresh; otherwise null. */
  verifyWebhook(rawBody: string, headers: Headers, now: Date): WebhookEvent | null;
}

const TOLERANCE_S = 300;

/** Stripe-style signature: header `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. */
export function signWebhook(secret: string, rawBody: string, at: Date) {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export function verifySignature(secret: string, rawBody: string, header: string | null, now: Date): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1)) return false;
  if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

/**
 * FakeProvider (dev, tests, E2E). Its hosted checkout page lives under /fake-gateway on this server. The outcome depends on
 * the amount charged: totals ending in .13 are declined, .14 fail for insufficient funds, everything else succeeds.
 */
export function fakeOutcome(totalMinor: number): { ok: true } | { ok: false; code: string } {
  if (totalMinor % 100 === 13) return { ok: false, code: 'card_declined' };
  if (totalMinor % 100 === 14) return { ok: false, code: 'insufficient_funds' };
  return { ok: true };
}

export interface FakeCheckout {
  ref: string;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  done: boolean;
}

export function createFakeProvider(a: { secret: string; publicUrl: string }): PaymentProvider & { checkouts: Map<string, FakeCheckout>; secret: string } {
  const checkouts = new Map<string, FakeCheckout>();
  return {
    id: 'fake',
    secret: a.secret,
    checkouts,
    async createCheckout(c) {
      const ref = `fk_${randomBytes(12).toString('hex')}`;
      checkouts.set(ref, { ref, amountMinor: c.amountMinor, currency: c.currency, description: c.description, returnUrl: c.returnUrl, done: false });
      return { providerRef: ref, checkoutUrl: `${a.publicUrl}/fake-gateway/checkout/${ref}` };
    },
    verifyWebhook(rawBody, headers, now) {
      if (!verifySignature(a.secret, rawBody, headers.get(FAKE_SIGNATURE_HEADER), now)) return null;
      try {
        const parsed = webhookEvent.safeParse(JSON.parse(rawBody));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}
