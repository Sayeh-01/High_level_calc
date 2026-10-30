import { describe, expect, it } from 'vitest';
import { can, customRoleProblem } from '../src/permissions';

describe('custom roles', () => {
  const policy = { customRoles: { cashier: { base: 'member' as const, grant: ['money.write' as const], deny: ['items.create' as const] }, viewer: { base: 'member' as const, deny: ['items.read' as const, 'chat' as const] } } };
  it('grant and deny on top of a base role', () => {
    expect(can('member', 'money.write', policy, 'cashier')).toBe(true);
    expect(can('member', 'items.create', policy, 'cashier')).toBe(false);
    expect(can('member', 'items.read', policy, 'cashier')).toBe(true);
    expect(can('member', 'items.read', policy, 'viewer')).toBe(false);
    expect(can('member', 'items.read', policy, 'unknown')).toBe(true);
  });
  it('nobody can define a role above their own powers or with owner-only rights', () => {
    expect(customRoleProblem('admin', { base: 'member', grant: ['money.write'] })).toBeNull();
    expect(customRoleProblem('admin', { base: 'owner' })).toBe('base_too_high');
    expect(customRoleProblem('manager', { base: 'admin' })).toBe('base_too_high');
    expect(customRoleProblem('admin', { base: 'member', grant: ['group.delete'] })).toBe('owner_only');
    expect(customRoleProblem('admin', { base: 'member', grant: ['group.transfer'] })).toBe('owner_only');
    expect(customRoleProblem('manager', { base: 'member', grant: ['group.settings'] })).toBe('grant_too_high');
    expect(customRoleProblem('admin', { base: 'guest' })).toBe('bad_base');
  });
});
