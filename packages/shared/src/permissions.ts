// The permission matrix (A11). Server middleware is the only place that enforces it; the app uses it to hide UI.

export const ROLES = ['owner', 'admin', 'manager', 'member', 'child', 'guest', 'vendor'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  /** See the group at all (name, members, modules). Guests and vendors only see items shared with them. */
  'group.read': ['owner', 'admin', 'manager', 'member', 'child', 'vendor'],
  'group.delete': ['owner'],
  'group.transfer': ['owner'],
  /** Change modules, settings, roles */
  'group.settings': ['owner', 'admin'],
  /** Members may invite only when the group allows it (group.settings.membersCanInvite) */
  'members.invite': ['owner', 'admin', 'manager', 'member'],
  'members.remove': ['owner', 'admin'],
  /** Create tasks, events, polls (lists use lists.create, which Child also has) */
  'items.create': ['owner', 'admin', 'manager', 'member'],
  'items.read': ['owner', 'admin', 'manager', 'member', 'child'],
  'lists.create': ['owner', 'admin', 'manager', 'member', 'child'],
  /** Edit or delete any item, not just your own */
  'items.manage': ['owner', 'admin', 'manager'],
  approve: ['owner', 'admin', 'manager'],
  'money.read': ['owner', 'admin', 'manager', 'member'],
  'money.write': ['owner', 'admin', 'manager', 'member'],
  /** Vault is further restricted per folder */
  vault: ['owner', 'admin', 'manager', 'member'],
  chat: ['owner', 'admin', 'manager', 'member', 'child'],
  announce: ['owner', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export interface GroupPolicy {
  membersCanInvite?: boolean;
  /** v3.2 custom roles: extra permissions granted on top of the base role, keyed by custom role id */
  customRoles?: Record<string, { base: Role; grant?: Permission[]; deny?: Permission[] }>;
}

export function can(role: Role, permission: Permission, policy: GroupPolicy = {}, customRoleId?: string | null): boolean {
  if (customRoleId && policy.customRoles?.[customRoleId]) {
    const cr = policy.customRoles[customRoleId];
    if (cr.deny?.includes(permission)) return false;
    if (cr.grant?.includes(permission)) return true;
    role = cr.base;
  }
  if (permission === 'members.invite' && role === 'member' && policy.membersCanInvite === false) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Roles a person can be given through the members screen (owner changes only via transfer). */
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'manager', 'member', 'child'];

export const ROLE_RANK: Record<Role, number> = {
  owner: 6,
  admin: 5,
  manager: 4,
  member: 3,
  vendor: 2,
  child: 1,
  guest: 0,
};

/** Why a custom role definition isn't allowed for this actor, or null. No owner-only rights; nothing the actor lacks. */
export function customRoleProblem(actorRole: Role, def: { base: Role; grant?: Permission[] }): string | null {
  if (!['admin', 'manager', 'member', 'vendor'].includes(def.base)) return def.base === 'owner' ? 'base_too_high' : 'bad_base';
  if (ROLE_RANK[def.base] > ROLE_RANK[actorRole] || (def.base === actorRole && actorRole !== 'owner' && actorRole !== 'admin')) return 'base_too_high';
  if (def.grant?.some((p) => p === 'group.delete' || p === 'group.transfer')) return 'owner_only';
  if (def.grant?.some((p) => !can(actorRole, p))) return 'grant_too_high';
  return null;
}
