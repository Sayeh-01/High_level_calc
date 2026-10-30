import type { PlanId } from '@circle/shared';

/**
 * Store purchases (B4: RevenueCat + store products are an outside account). This adapter is the seam: the real one will
 * call react-native-purchases and the server will learn about the purchase from RevenueCat's verified webhook — the app
 * never tells the server "I paid". Until then purchases are unavailable and plans are granted with the admin CLI.
 */
export interface Purchases {
  available: boolean;
  purchase(plan: PlanId, groupId?: string): Promise<void>;
  restore(): Promise<void>;
}

export class StoreUnavailable extends Error {
  constructor() {
    super('store_unavailable');
  }
}

export const purchases: Purchases = {
  available: false,
  async purchase() {
    throw new StoreUnavailable();
  },
  async restore() {
    throw new StoreUnavailable();
  },
};
