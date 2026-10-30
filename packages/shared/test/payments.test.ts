import { describe, expect, it } from 'vitest';
import { DEFAULT_FEE, paymentQuote } from '../src/payments';

describe('payment quote (B9 v2.6): fees round correctly in minor units', () => {
  it('the payer pays amount + fee; the payee receives exactly the amount', () => {
    expect(paymentQuote(20000, { bps: 150, fixedMinor: 0 })).toEqual({ amount: 20000, fee: 300, total: 20300, payeeReceives: 20000 });
    expect(paymentQuote(333, { bps: 150, fixedMinor: 0 })).toMatchObject({ fee: 5, total: 338 }); // 4.995 → 5
    expect(paymentQuote(299, { bps: 150, fixedMinor: 0 })).toMatchObject({ fee: 4, total: 303 }); // 4.485 → 4
    expect(paymentQuote(100000, { bps: 250, fixedMinor: 200 })).toMatchObject({ fee: 2700, total: 102700 }); // 2.5% + 2.00
  });

  it('every quote is whole minor units and adds up, across many amounts', () => {
    for (let amount = 1; amount < 50000; amount += 37) {
      const q = paymentQuote(amount, DEFAULT_FEE);
      expect(Number.isInteger(q.fee) && Number.isInteger(q.total)).toBe(true);
      expect(q.total).toBe(q.amount + q.fee);
      // never more than half a minor unit away from the exact percentage
      expect(Math.abs(q.fee - DEFAULT_FEE.fixedMinor - (amount * DEFAULT_FEE.bps) / 10000)).toBeLessThanOrEqual(0.5);
    }
  });

  it('refuses non-integer, zero or negative amounts', () => {
    expect(() => paymentQuote(10.5, DEFAULT_FEE)).toThrow();
    expect(() => paymentQuote(0, DEFAULT_FEE)).toThrow();
    expect(() => paymentQuote(-100, DEFAULT_FEE)).toThrow();
  });
});
