import { PLANS, isActive, memberLimit, type PlanId } from '@circle/shared';
import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from './db/client';
import { entitlements, groupMembers, groups } from './db/schema';
import { HttpError } from './errors';
import { newId } from './ids';

// Entitlements (v2.4). Reading is everywhere; writing is only grantEntitlement/revokeEntitlement, which only the admin CLI
// calls. Keep it that way: B9 v2.4 sweeps every route to prove no request can grant a plan.

export async function activePlans(db: DbOrTx, scope: 'user' | 'group', subjectId: string, now: Date) {
  const rows = await db.select().from(entitlements).where(and(eq(entitlements.scope, scope), eq(entitlements.subjectId, subjectId)));
  return rows.filter((e) => isActive(e, now));
}

export async function groupPlanInfo(db: DbOrTx, groupId: string, now: Date) {
  // a department (sub-group, v3.2) is covered by its parent's plan
  const [g] = await db.select({ parentId: groups.parentId }).from(groups).where(eq(groups.id, groupId));
  const active = [...(await activePlans(db, 'group', groupId, now)), ...(g?.parentId ? await activePlans(db, 'group', g.parentId, now) : [])];
  const limit = memberLimit(active.map((e) => e.plan));
  const best = active.map((e) => e.plan as PlanId).sort((a, b) => (PLANS[b]?.members ?? 0) - (PLANS[a]?.members ?? 0))[0] ?? 'free';
  return { plan: best, limit, entitlements: active };
}

/** Throws 402 upgrade_required when the group has no free seat. Call inside the transaction that adds the member. */
export async function assertSeat(db: DbOrTx, groupId: string, now: Date) {
  // lock the group row so two joins can't both take the last seat
  await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for('update');
  const members = await db.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId));
  const { plan, limit } = await groupPlanInfo(db, groupId, now);
  if (members.length >= limit) throw new HttpError(402, 'upgrade_required', `This group is full (${limit} members on ${PLANS[plan].name.en}).`, { plan, limit, members: members.length, upgradeTo: plan === 'free' ? 'group_pro' : null });
}

export async function grantEntitlement(
  db: DbOrTx,
  a: { scope: 'user' | 'group'; subjectId: string; plan: PlanId; days?: number | null; source?: string; grantedBy: string; note?: string; now?: Date },
) {
  const plan = PLANS[a.plan];
  if (!plan) throw new Error(`unknown plan ${a.plan}`);
  if (plan.scope !== a.scope) throw new Error(`${a.plan} is a ${plan.scope} plan`);
  if (a.plan === 'free') throw new Error('free needs no entitlement');
  const now = a.now ?? new Date();
  const [row] = await db
    .insert(entitlements)
    .values({ id: newId(), scope: a.scope, subjectId: a.subjectId, plan: a.plan, source: a.source ?? 'admin', note: a.note ?? null, grantedBy: a.grantedBy, startsAt: now, expiresAt: a.days ? new Date(now.getTime() + a.days * 86_400_000) : null })
    .returning();
  return row;
}

export async function revokeEntitlement(db: DbOrTx, id: string, now = new Date()) {
  const [row] = await db.update(entitlements).set({ revokedAt: now }).where(eq(entitlements.id, id)).returning();
  return row ?? null;
}
