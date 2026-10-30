import { describe, expect, it } from 'vitest';
import { approvalLimit, lowStockChange } from '../src/ops';

describe('low stock (B9 v3.x): one alert per threshold crossing', () => {
  it('alerts only when going from above the threshold to at/below it; re-arms when restocked above', () => {
    expect(lowStockChange({ quantity: 12, lowAt: 5, low: false }, 6)).toEqual({ low: false, alert: false });
    expect(lowStockChange({ quantity: 6, lowAt: 5, low: false }, 5)).toEqual({ low: true, alert: true });
    expect(lowStockChange({ quantity: 5, lowAt: 5, low: true }, 2)).toEqual({ low: true, alert: false });
    expect(lowStockChange({ quantity: 2, lowAt: 5, low: true }, 4)).toEqual({ low: true, alert: false });
    expect(lowStockChange({ quantity: 4, lowAt: 5, low: true }, 20)).toEqual({ low: false, alert: false });
    expect(lowStockChange({ quantity: 20, lowAt: 5, low: false }, 1)).toEqual({ low: true, alert: true });
    expect(lowStockChange({ quantity: 3, lowAt: 0, low: false }, 0)).toEqual({ low: true, alert: true });
  });
});

describe('approval limits (B9 v3.x): per role', () => {
  const policy = { approvalLimits: { manager: 50000, member: 5000, supervisor: 20000 }, customRoles: { supervisor: { base: 'member' as const } } };
  it('a custom role’s own limit wins, then the base role; owners are unlimited; no limit set = 0', () => {
    expect(approvalLimit(policy, 'owner', null)).toBe(Infinity);
    expect(approvalLimit(policy, 'manager', null)).toBe(50000);
    expect(approvalLimit(policy, 'member', null)).toBe(5000);
    expect(approvalLimit(policy, 'member', 'supervisor')).toBe(20000);
    expect(approvalLimit(policy, 'admin', null)).toBe(0);
    expect(approvalLimit({}, 'member', null)).toBe(0);
  });
});
