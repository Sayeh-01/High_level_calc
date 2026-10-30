import type { GroupPolicy, Role } from './permissions';

// Operations (v3.6): inventory thresholds and spending limits per role.

/** After a stock change: is the item low now, and should an alert go out? Once per crossing; restocking re-arms it. */
export function lowStockChange(item: { quantity: number; lowAt: number; low: boolean }, next: number): { low: boolean; alert: boolean } {
  const low = next <= item.lowAt;
  return { low, alert: low && !item.low };
}

/** How much this person may spend or approve. A custom role's own limit, else the base role's; owners are unlimited. */
export function approvalLimit(policy: GroupPolicy & { approvalLimits?: Record<string, number> }, role: Role, customRoleId: string | null | undefined): number {
  if (role === 'owner') return Infinity;
  const limits = policy.approvalLimits ?? {};
  if (customRoleId && limits[customRoleId] !== undefined) return limits[customRoleId];
  return limits[role] ?? 0;
}
