import type { L10n } from './templates';

// Plans are data (A16; prices are hypotheses). Entitlements in the database say who has which plan; nothing in the app grants
// one (v2.4: only the admin CLI; real store purchases through RevenueCat later).

export type PlanId = 'free' | 'plus' | 'group_pro' | 'business' | 'property' | 'community';

export interface Plan {
  id: PlanId;
  /** a user plan follows the person; a group plan covers everyone in that group */
  scope: 'user' | 'group';
  name: L10n;
  /** member cap for group plans (Free applies when a group has no group plan) */
  members?: number;
  features: L10n[];
  price: { egp: number; usd: number; per: 'month' | 'seat' | 'unit' };
  /** sold in the app (v2.4); the others arrive with their phase */
  sold: boolean;
}

export const FREE_MEMBER_LIMIT = 15;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    scope: 'group',
    name: { en: 'Free', ar: 'مجاني' },
    members: FREE_MEMBER_LIMIT,
    features: [{ en: 'Unlimited groups, up to 15 members each', ar: 'مجموعات بلا حدود، لحد 15 عضو في كل مجموعة' }, { en: 'All core modules, no ads', ar: 'كل الأدوات الأساسية، بدون إعلانات' }],
    price: { egp: 0, usd: 0, per: 'month' },
    sold: false,
  },
  plus: {
    id: 'plus',
    scope: 'user',
    name: { en: 'Circle Plus', ar: 'Circle بلس' },
    features: [
      { en: 'AI assistant', ar: 'المساعد الذكي' },
      { en: 'Vault with expiry alerts', ar: 'الخزنة مع تنبيهات الانتهاء' },
      { en: 'Unlimited history', ar: 'سجل بلا حدود' },
      { en: 'Widgets and themes', ar: 'الويدجت والثيمات' },
    ],
    price: { egp: 7900, usd: 399, per: 'month' },
    sold: true,
  },
  group_pro: {
    id: 'group_pro',
    scope: 'group',
    name: { en: 'Group Pro', ar: 'Group Pro' },
    members: 100,
    features: [
      { en: 'Up to 100 members', ar: 'لحد 100 عضو' },
      { en: 'Sub-groups', ar: 'مجموعات فرعية' },
      { en: 'Dues and exports', ar: 'الاشتراكات والتصدير' },
      { en: 'Admin tools', ar: 'أدوات الإدارة' },
    ],
    price: { egp: 14900, usd: 699, per: 'month' },
    sold: true,
  },
  business: { id: 'business', scope: 'group', name: { en: 'Business', ar: 'بيزنس' }, members: 500, features: [{ en: 'Shifts, time clock, inventory, approvals, reports', ar: 'الورديات والحضور والمخزون والموافقات والتقارير' }], price: { egp: 6000, usd: 300, per: 'seat' }, sold: false },
  property: { id: 'property', scope: 'group', name: { en: 'Property', ar: 'عقارات' }, members: 500, features: [{ en: 'Leases, rent, maintenance, inspections, statements', ar: 'العقود والإيجار والصيانة والمعاينات والكشوف' }], price: { egp: 4000, usd: 150, per: 'unit' }, sold: false },
  community: { id: 'community', scope: 'group', name: { en: 'Community', ar: 'كمبوند' }, members: 2000, features: [{ en: 'Booking, voting, visitors, dues', ar: 'الحجز والتصويت والزوار والاشتراكات' }], price: { egp: 1500, usd: 75, per: 'unit' }, sold: false },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** The member cap of a group given its active group plans (the most generous wins). */
export function memberLimit(activeGroupPlans: string[]): number {
  return Math.max(FREE_MEMBER_LIMIT, ...activeGroupPlans.map((p) => PLANS[p as PlanId]?.members ?? 0));
}

export interface EntitlementLike {
  plan: string;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  revokedAt: Date | string | null;
}

export function isActive(e: EntitlementLike, now: Date): boolean {
  if (e.revokedAt) return false;
  if (new Date(e.startsAt).getTime() > now.getTime()) return false;
  return e.expiresAt === null || new Date(e.expiresAt).getTime() > now.getTime();
}
