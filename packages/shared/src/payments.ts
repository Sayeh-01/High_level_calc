import { feeMinor } from './money';

// Payments through a gateway (A12 stage 2, v2.6). The gateway collects from the payer and pays the payee directly: Circle
// never holds a balance. The payer covers the transaction fee, so the payee gets exactly what was owed.

export interface FeePolicy {
  /** percentage in basis points (150 = 1.5%) */
  bps: number;
  fixedMinor: number;
}

/** A16: transactions 1–2.5%. A hypothesis; set with FEE_BPS / FEE_FIXED_MINOR on the server. */
export const DEFAULT_FEE: FeePolicy = { bps: 150, fixedMinor: 0 };

export type PaymentPurpose = 'due' | 'settlement' | 'gameya';

export function paymentQuote(amount: number, policy: FeePolicy) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer of minor units');
  const fee = feeMinor(amount, policy.bps, policy.fixedMinor);
  return { amount, fee, total: amount + fee, payeeReceives: amount };
}
