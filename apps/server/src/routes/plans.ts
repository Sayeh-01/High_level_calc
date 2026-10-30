import { PLANS } from '@circle/shared';
import { count, eq } from 'drizzle-orm';
import { groupMembers } from '../db/schema';
import type { Deps } from '../deps';
import { activePlans, groupPlanInfo } from '../entitlements';
import type { Router } from '../http';

// v2.4: read-only views of plans and entitlements. There is deliberately no route that writes an entitlement (B4, B9 v2.4):
// the admin CLI grants them in dev; store purchases will arrive through a verified server-to-server webhook.

export function registerPlanRoutes(r: Router, deps: Deps) {
  const { db } = deps;

  r.get('/plans', { auth: 'public', tags: ['plans'], summary: 'Plan catalog (prices are hypotheses, A16)' }, async () => Object.values(PLANS));

  r.get('/me/plan', { tags: ['plans'], summary: 'My personal plan (Plus)' }, async (c) => {
    const active = await activePlans(db, 'user', c.get('user').id, deps.clock());
    const plus = active.find((e) => e.plan === 'plus');
    return { plus: !!plus, expiresAt: plus?.expiresAt ?? null };
  });

  r.get('/groups/:groupId/plan', { perm: 'group.read', tags: ['plans'], summary: 'This group’s plan, member cap and seats used' }, async (c) => {
    const group = c.get('group');
    const info = await groupPlanInfo(db, group.id, deps.clock());
    const [{ n }] = await db.select({ n: count() }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    return { plan: info.plan, limit: info.limit, members: n, full: n >= info.limit, expiresAt: info.entitlements.find((e) => e.plan === info.plan)?.expiresAt ?? null };
  });
}
