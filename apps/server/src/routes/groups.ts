import { ASSIGNABLE_ROLES, MODULE_IDS, ROLE_RANK, getTemplate, schemas, type Lang, type Role } from '@circle/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { files, groupMembers, groups, invites, messages, tasks, users } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, emitUser, type Router } from '../http';
import { assertSeat, groupPlanInfo } from '../entitlements';
import { newCode, newId } from '../ids';
import { createStarterContent } from './starters';

export async function memberIds(db: DbOrTx, groupId: string): Promise<string[]> {
  const rows = await db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => r.userId);
}

/** Throws 400 unless every id is a member of the group. */
export async function assertMembers(db: DbOrTx, groupId: string, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return;
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, wanted)));
  if (rows.length !== wanted.length) throw badRequest('not_a_member', 'Everyone involved must be a member of this group');
}

export function availableModules(): string[] {
  return MODULE_IDS;
}

function sanitizeModules(mods: string[]): string[] {
  const allowed = new Set(availableModules());
  return [...new Set(mods)].filter((m) => allowed.has(m));
}

async function activeInvite(db: DbOrTx, groupId: string, userId: string) {
  const [existing] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.groupId, groupId), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt))
    .limit(1);
  if (existing) return existing;
  const row = { id: newId(), groupId, code: newCode(), createdBy: userId };
  await db.insert(invites).values(row);
  return { ...row, createdAt: new Date(), revokedAt: null, uses: 0 };
}

function inviteLinks(deps: Deps, code: string) {
  return { code, deepLink: `circleapp://join/${code}`, webLink: `https://${deps.env.linkDomain}/join/${code}` };
}

/** Hook for later versions: extra work when someone joins (e.g. add to rotations). */
export const onJoinHooks: ((db: DbOrTx, groupId: string, userId: string) => Promise<void>)[] = [];

export async function addMember(
  db: DbOrTx,
  group: typeof groups.$inferSelect,
  userId: string,
  role: Role,
  displayName: string,
  now: Date,
) {
  await assertSeat(db, group.id, now); // plan member cap (v2.4)
  await db.insert(groupMembers).values({ groupId: group.id, userId, role, displayName });
  // rotation chores include new members automatically
  await db
    .update(tasks)
    .set({ rotation: sql`array_append(${tasks.rotation}, ${userId})` })
    .where(and(eq(tasks.groupId, group.id), sql`${tasks.rotation} is not null`, sql`not (${userId} = any(${tasks.rotation}))`));
  for (const hook of onJoinHooks) await hook(db, group.id, userId);
}

export function registerGroupRoutes(r: Router, deps: Deps) {
  const { db } = deps;

  r.post('/groups', { summary: 'Create a group from a template', body: schemas.groupCreate, tags: ['groups'] }, async (c, { body }) => {
    const user = c.get('user');
    if (user.isChild) throw forbidden('child_account');
    const t = getTemplate(body.templateId);
    const lang = body.lang as Lang;
    const id = newId();
    const modules = sanitizeModules(t.id === 'custom' ? body.modules ?? [] : body.modules ?? t.modules);
    const tz = body.timezone ?? user.timezone ?? 'Africa/Cairo';
    const now = deps.clock();
    const result = await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id,
        type: t.id,
        name: body.name,
        emoji: body.emoji ?? t.emoji,
        color: body.color ?? t.color,
        modules,
        currency: body.currency ?? t.defaults.currency ?? 'EGP',
        timezone: tz,
        settings: { membersCanInvite: true, ...t.defaults },
        createdBy: user.id,
      });
      await tx.insert(groupMembers).values({ groupId: id, userId: user.id, role: 'owner', displayName: user.name });
      await createStarterContent(tx, { groupId: id, template: t, modules, userId: user.id, tz, lang, now });
      const invite = await activeInvite(tx, id, user.id);
      await logActivity(tx, { groupId: id, actorId: user.id, verb: 'created', entity: 'group', entityId: id, summary: body.name });
      return invite;
    });
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    // the creator's open sockets start listening to the new group
    emitUser(c, user.id, { type: 'membership', groupId: id });
    return { group, invite: inviteLinks(deps, result.code) };
  });

  r.get('/groups', { summary: 'My groups, most recent activity first', tags: ['groups'] }, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select({ group: groups, member: groupMembers })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, user.id))
      .orderBy(desc(groupMembers.pinned), desc(groups.lastActivityAt));
    const ids = rows.map((r) => r.group.id);
    const unread = ids.length
      ? await db
          .select({ groupId: messages.groupId, n: count() })
          .from(messages)
          .innerJoin(groupMembers, and(eq(groupMembers.groupId, messages.groupId), eq(groupMembers.userId, user.id)))
          .where(and(inArray(messages.groupId, ids), gt(messages.createdAt, groupMembers.lastReadAt), ne(messages.userId, user.id), isNull(messages.deletedAt)))
          .groupBy(messages.groupId)
      : [];
    const counts = await (ids.length
      ? db.select({ groupId: groupMembers.groupId, n: count() }).from(groupMembers).where(inArray(groupMembers.groupId, ids)).groupBy(groupMembers.groupId)
      : Promise.resolve([] as { groupId: string; n: number }[]));
    return rows.map((r) => ({
      ...r.group,
      role: r.member.role,
      displayName: r.member.displayName,
      pinned: r.member.pinned,
      unread: unread.find((u) => u.groupId === r.group.id)?.n ?? 0,
      memberCount: counts.find((x) => x.groupId === r.group.id)?.n ?? 1,
    }));
  });

  r.get('/groups/:groupId', { summary: 'Group detail with members', tags: ['groups'] }, async (c) => {
    const group = c.get('group');
    const member = c.get('member');
    const members = await db
      .select({
        userId: groupMembers.userId,
        role: groupMembers.role,
        customRoleId: groupMembers.customRoleId,
        displayName: groupMembers.displayName,
        away: groupMembers.away,
        joinedAt: groupMembers.joinedAt,
        image: users.image,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, group.id))
      .orderBy(asc(groupMembers.joinedAt));
    return { group, me: member, members };
  });

  r.patch('/groups/:groupId', { summary: 'Edit name, emoji, photo, settings', perm: 'group.settings', body: schemas.groupUpdate, tags: ['groups'] }, async (c, { body }) => {
    const group = c.get('group');
    const { membersCanInvite, ...fields } = body;
    if (fields.photo) {
      const [f] = await db.select().from(files).where(and(eq(files.id, fields.photo), eq(files.groupId, group.id)));
      if (!f) throw badRequest('bad_file');
    }
    const settings = membersCanInvite === undefined ? group.settings : { ...group.settings, membersCanInvite };
    await db.transaction(async (tx) => {
      await tx.update(groups).set({ ...fields, settings }).where(eq(groups.id, group.id));
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'updated', entity: 'group', entityId: group.id });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'group' });
    const [updated] = await db.select().from(groups).where(eq(groups.id, group.id));
    return updated;
  });

  r.put('/groups/:groupId/modules', { summary: 'Switch modules on or off', perm: 'group.settings', body: schemas.modulesUpdate, tags: ['groups'] }, async (c, { body }) => {
    const group = c.get('group');
    const modules = sanitizeModules(body.modules);
    await db.transaction(async (tx) => {
      await tx.update(groups).set({ modules }).where(eq(groups.id, group.id));
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'updated', entity: 'modules', summary: modules.join(',') });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'group' });
    return { modules };
  });

  r.delete('/groups/:groupId', { summary: 'Delete the group (owner only)', perm: 'group.delete', tags: ['groups'] }, async (c) => {
    const group = c.get('group');
    const ids = await memberIds(db, group.id);
    await db.delete(groups).where(eq(groups.id, group.id));
    for (const uid of ids) emitUser(c, uid, { type: 'membership', groupId: group.id });
    return { ok: true };
  });

  r.post('/groups/:groupId/transfer', { summary: 'Transfer ownership', perm: 'group.transfer', body: schemas.transferOwnership, tags: ['groups'] }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user');
    if (body.userId === me.id) throw badRequest('already_owner');
    await db.transaction(async (tx) => {
      const [target] = await tx.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, body.userId)));
      if (!target) throw badRequest('not_a_member');
      if (target.role === 'child') throw badRequest('child_cannot_own');
      await tx.update(groupMembers).set({ role: 'owner' }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, body.userId)));
      await tx.update(groupMembers).set({ role: 'admin' }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, me.id)));
      await logActivity(tx, { groupId: group.id, actorId: me.id, verb: 'transferred', entity: 'group', entityId: body.userId });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    return { ok: true };
  });

  r.patch('/groups/:groupId/members/:userId', { summary: 'Change a member (role) or yourself (display name, away)', body: schemas.memberUpdate, tags: ['groups'] }, async (c, { body }) => {
    const group = c.get('group');
    const me = c.get('user');
    const targetId = c.req.param('userId')!;
    const self = targetId === me.id;
    const [target] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, targetId)));
    if (!target) throw notFound();
    const patch: Partial<typeof groupMembers.$inferInsert> = {};
    if (body.role !== undefined || body.customRoleId !== undefined) {
      if (!actorCan(c, 'group.settings')) throw forbidden();
      if (target.role === 'owner') throw badRequest('use_transfer');
      if (body.role) {
        if (!ASSIGNABLE_ROLES.includes(body.role)) throw badRequest('bad_role');
        patch.role = body.role;
      }
      if (body.customRoleId !== undefined) {
        const custom = (group.settings as any)?.customRoles ?? {};
        if (body.customRoleId && !custom[body.customRoleId]) throw badRequest('unknown_custom_role');
        patch.customRoleId = body.customRoleId;
      }
    }
    if (body.displayName !== undefined) {
      if (!self && !actorCan(c, 'group.settings')) throw forbidden();
      patch.displayName = body.displayName;
    }
    if (body.away !== undefined) {
      if (!self && !actorCan(c, 'items.manage')) throw forbidden();
      patch.away = body.away;
    }
    if (Object.keys(patch).length) {
      await db.transaction(async (tx) => {
        await tx.update(groupMembers).set(patch).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, targetId)));
        await logActivity(tx, { groupId: group.id, actorId: me.id, verb: 'updated', entity: 'member', entityId: targetId });
      });
    }
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    return { ok: true };
  });

  r.delete('/groups/:groupId/members/:userId', { summary: 'Remove a member', perm: 'members.remove', tags: ['groups'] }, async (c) => {
    const group = c.get('group');
    const targetId = c.req.param('userId')!;
    const [target] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, targetId)));
    if (!target) throw notFound();
    if (target.role === 'owner') throw badRequest('cannot_remove_owner');
    if (ROLE_RANK[target.role as Role] >= ROLE_RANK[c.get('member').role as Role] && c.get('member').role !== 'owner') throw forbidden();
    await db.transaction(async (tx) => {
      await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, targetId)));
      await logActivity(tx, { groupId: group.id, actorId: c.get('user').id, verb: 'removed', entity: 'member', entityId: targetId, summary: target.displayName });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    emitUser(c, targetId, { type: 'membership', groupId: group.id });
    return { ok: true };
  });

  r.post('/groups/:groupId/leave', { summary: 'Leave the group', tags: ['groups'] }, async (c) => {
    const group = c.get('group');
    const member = c.get('member');
    if (member.role === 'owner') {
      const others = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), ne(groupMembers.userId, member.userId)));
      if (others.length > 0) throw conflict('transfer_first', 'Transfer ownership before leaving');
      await db.delete(groups).where(eq(groups.id, group.id));
    } else {
      await db.transaction(async (tx) => {
        await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, member.userId)));
        await logActivity(tx, { groupId: group.id, actorId: member.userId, verb: 'left', entity: 'member', entityId: member.userId, summary: member.displayName });
      });
      emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    }
    emitUser(c, member.userId, { type: 'membership', groupId: group.id });
    return { ok: true };
  });

  r.get('/groups/:groupId/invite', { summary: 'The active invite code', perm: 'members.invite', tags: ['groups'] }, async (c) => {
    const invite = await activeInvite(db, c.get('group').id, c.get('user').id);
    return inviteLinks(deps, invite.code);
  });

  r.post('/groups/:groupId/invite/rotate', { summary: 'Revoke the code and make a new one', perm: 'group.settings', tags: ['groups'] }, async (c) => {
    const group = c.get('group');
    await db.update(invites).set({ revokedAt: deps.clock() }).where(and(eq(invites.groupId, group.id), isNull(invites.revokedAt)));
    const invite = await activeInvite(db, group.id, c.get('user').id);
    return inviteLinks(deps, invite.code);
  });

  async function findInvite(code: string) {
    const [row] = await db
      .select({ invite: invites, group: groups })
      .from(invites)
      .innerJoin(groups, eq(groups.id, invites.groupId))
      .where(and(eq(invites.code, code.toUpperCase()), isNull(invites.revokedAt)))
      .limit(1);
    if (!row) throw notFound('invite_not_found');
    return row;
  }

  r.get('/invites/:code', { summary: 'Preview a group before joining', tags: ['groups'] }, async (c) => {
    if (c.get('user').isChild) throw forbidden('child_account');
    const { invite, group } = await findInvite(c.req.param('code')!);
    const [inviter] = await db.select({ name: groupMembers.displayName }).from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, invite.createdBy)));
    const [{ n }] = await db.select({ n: count() }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
    const [mine] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, c.get('user').id)));
    const { limit } = await groupPlanInfo(db, group.id, deps.clock());
    return { groupId: group.id, name: group.name, emoji: group.emoji, color: group.color, type: group.type, inviter: inviter?.name ?? null, memberCount: n, alreadyMember: !!mine, memberLimit: limit, full: !mine && n >= limit };
  });

  r.post('/invites/:code/join', { summary: 'Join with a code', body: z.object({ displayName: z.string().trim().max(60).optional() }), tags: ['groups'] }, async (c, { body }) => {
    const user = c.get('user');
    if (user.isChild) throw forbidden('child_account');
    const { invite, group } = await findInvite(c.req.param('code')!);
    const [mine] = await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, user.id)));
    if (mine) return { groupId: group.id, alreadyMember: true };
    const displayName = body.displayName || user.name;
    try {
      await db.transaction(async (tx) => {
        await addMember(tx, group, user.id, 'member', displayName, deps.clock());
        await tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.id, invite.id));
        await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'joined', entity: 'member', entityId: user.id, summary: displayName });
      });
    } catch (e) {
      if (e instanceof HttpError && e.code === 'upgrade_required') {
        // tell the organizers someone is waiting at the door (the app opens the Group Pro paywall from this)
        const admins = (await db.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).filter((m) => m.role === 'owner' || m.role === 'admin');
        await notify(db, { userIds: admins.map((m) => m.u), groupId: group.id, kind: 'group_full', title: `${group.emoji} ${group.name}`, body: `${displayName} couldn't join: the group is full`, data: { href: `/paywall?plan=group_pro&groupId=${group.id}` }, now: deps.clock() });
      }
      throw e;
    }
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    emitUser(c, user.id, { type: 'membership', groupId: group.id });
    return { groupId: group.id, alreadyMember: false };
  });

  r.patch('/groups/:groupId/me', { summary: 'My identity in this group', body: z.object({ displayName: z.string().trim().min(1).max(60).optional(), pinned: z.boolean().optional() }), tags: ['groups'] }, async (c, { body }) => {
    const group = c.get('group');
    await db.update(groupMembers).set(body).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, c.get('user').id)));
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    return { ok: true };
  });
}
