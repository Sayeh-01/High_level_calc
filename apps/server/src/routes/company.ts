import { customRoleProblem, localDayKey, schemas, type GroupPolicy, type Role } from '@circle/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { checklistRuns, checklists, files, groupMembers, groups } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity, notify } from '../effects';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { actorCan, emit, emitUser, type Ctx, type Router } from '../http';
import { newId } from '../ids';
import { addMember, onJoinHooks } from './groups';

// Company / Business (v3.2, A6): custom roles, departments as sub-groups, opening/closing/onboarding checklists with time
// stamps and photo proof. The SOP wiki is the Notes module, renamed by the template.

type Checklist = typeof checklists.$inferSelect;

/** Onboarding: each new member gets their own run of every onboarding checklist. */
onJoinHooks.push(async (db, groupId, userId) => {
  const lists = await db.select().from(checklists).where(and(eq(checklists.groupId, groupId), eq(checklists.kind, 'onboarding'), eq(checklists.active, true)));
  for (const l of lists) await db.insert(checklistRuns).values({ id: newId(), checklistId: l.id, groupId, subjectUserId: userId }).onConflictDoNothing();
});

export function registerCompanyRoutes(r: Router, deps: Deps) {
  const { db } = deps;
  const base = '/groups/:groupId';

  // ── custom roles (B9 v3.x: they pass the sweep) ─────────────────────────────
  r.get(`${base}/roles`, { perm: 'group.read', tags: ['roles'], summary: 'Custom roles of this group' }, async (c) => {
    const roles = ((c.get('group').settings as GroupPolicy).customRoles ?? {}) as Record<string, unknown>;
    return Object.entries(roles).map(([id, def]) => ({ id, ...(def as object) }));
  });

  r.put(`${base}/roles/:roleId`, { perm: 'group.settings', tags: ['roles'], summary: 'Create or change a custom role (a base role plus granted / denied permissions)', body: schemas.customRoleDef }, async (c, { body }) => {
    const group = c.get('group');
    const roleId = c.req.param('roleId')!;
    if (!/^[a-z0-9_-]{1,40}$/.test(roleId)) throw badRequest('bad_role_id');
    const problem = customRoleProblem(c.get('member').role as Role, body);
    if (problem) throw forbidden(problem);
    const settings = group.settings as GroupPolicy & Record<string, unknown>;
    const customRoles = { ...(settings.customRoles ?? {}), [roleId]: body };
    await db.update(groups).set({ settings: { ...settings, customRoles } }).where(eq(groups.id, group.id));
    await logActivity(db, { groupId: group.id, actorId: c.get('user').id, verb: 'updated', entity: 'role', summary: body.name });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'group' });
    return { id: roleId, ...body };
  });

  r.delete(`${base}/roles/:roleId`, { perm: 'group.settings', tags: ['roles'], summary: 'Delete a custom role (its members fall back to their base role)' }, async (c) => {
    const group = c.get('group');
    const roleId = c.req.param('roleId')!;
    const settings = group.settings as GroupPolicy & Record<string, unknown>;
    if (!settings.customRoles?.[roleId]) throw notFound();
    const { [roleId]: _gone, ...rest } = settings.customRoles;
    await db.transaction(async (tx) => {
      await tx.update(groups).set({ settings: { ...settings, customRoles: rest } }).where(eq(groups.id, group.id));
      await tx.update(groupMembers).set({ customRoleId: null }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.customRoleId, roleId)));
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'group' });
    return { ok: true };
  });

  // ── departments (sub-groups) ────────────────────────────────────────────────
  r.get(`${base}/subgroups`, { perm: 'group.read', tags: ['groups'], summary: 'Departments of this group (and whether I’m in each)' }, async (c) => {
    const group = c.get('group');
    const subs = await db.select().from(groups).where(eq(groups.parentId, group.id));
    const mine = subs.length ? await db.select({ g: groupMembers.groupId }).from(groupMembers).where(and(inArray(groupMembers.groupId, subs.map((s) => s.id)), eq(groupMembers.userId, c.get('user').id))) : [];
    const counts = subs.length ? await db.select({ g: groupMembers.groupId }).from(groupMembers).where(inArray(groupMembers.groupId, subs.map((s) => s.id))) : [];
    return subs.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, member: mine.some((m) => m.g === s.id), members: counts.filter((x) => x.g === s.id).length }));
  });

  r.post(`${base}/subgroups`, { perm: 'group.settings', tags: ['groups'], summary: 'Create a department from members of this group', body: schemas.subgroupCreate }, async (c, { body }) => {
    const group = c.get('group');
    if (group.parentId) throw badRequest('no_nested_departments');
    const user = c.get('user');
    const parentMembers = await db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id));
    if (body.memberIds.some((u) => !parentMembers.find((m) => m.userId === u))) throw badRequest('not_a_member');
    const now = deps.clock();
    const sub = await db.transaction(async (tx) => {
      const [g] = await tx
        .insert(groups)
        .values({ id: newId(), type: group.type, name: body.name, emoji: body.emoji ?? group.emoji, color: group.color, modules: group.modules, currency: group.currency, timezone: group.timezone, parentId: group.id, settings: { ...group.settings }, createdBy: user.id, createdAt: now })
        .returning();
      // the parent's owner and admins run every department; the chosen people join as they are in the parent
      const leads = parentMembers.filter((m) => m.role === 'owner' || m.role === 'admin');
      const people = [...leads, ...parentMembers.filter((m) => body.memberIds.includes(m.userId) && !leads.includes(m))];
      for (const m of people) await addMember(tx, g, m.userId, m.role === 'owner' ? 'owner' : (m.role as Role), m.displayName, now);
      await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'created', entity: 'department', entityId: g.id, summary: g.name });
      return { g, people };
    });
    for (const m of sub.people) emitUser(c, m.userId, { type: 'membership', groupId: sub.g.id });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'subgroups' });
    return sub.g;
  });

  // ── checklists ──────────────────────────────────────────────────────────────
  const ck = { module: 'checklists', tags: ['checklists'] };
  async function loadList(c: Ctx, tx: DbOrTx = db) {
    const [l] = await tx.select().from(checklists).where(and(eq(checklists.id, c.req.param('checklistId')!), eq(checklists.groupId, c.get('group').id), eq(checklists.active, true)));
    if (!l) throw notFound();
    return l;
  }
  const today = (c: Ctx) => localDayKey(deps.clock().getTime(), c.get('group').timezone);

  /** Today's run of a daily list, or my onboarding run (a manager may open someone else's with ?for=). */
  async function runFor(c: Ctx, l: Checklist, tx: DbOrTx = db) {
    const forUser = l.kind === 'onboarding' ? (c.req.query('for') ?? c.get('user').id) : '';
    if (forUser && forUser !== c.get('user').id && !actorCan(c, 'items.manage')) throw forbidden();
    const key = { day: l.kind === 'onboarding' ? '' : today(c), subjectUserId: forUser };
    await tx.insert(checklistRuns).values({ id: newId(), checklistId: l.id, groupId: l.groupId, ...key, createdAt: deps.clock() }).onConflictDoNothing();
    const [run] = await tx.select().from(checklistRuns).where(and(eq(checklistRuns.checklistId, l.id), eq(checklistRuns.day, key.day), eq(checklistRuns.subjectUserId, key.subjectUserId)));
    return run;
  }

  r.get(`${base}/checklists`, { ...ck, perm: 'items.read', summary: 'Checklists with today’s progress (or my onboarding)' }, async (c) => {
    const group = c.get('group');
    const lists = await db.select().from(checklists).where(and(eq(checklists.groupId, group.id), eq(checklists.active, true))).orderBy(checklists.createdAt);
    const runs = lists.length ? await db.select().from(checklistRuns).where(inArray(checklistRuns.checklistId, lists.map((l) => l.id))) : [];
    const me = c.get('user').id;
    return lists.map((l) => {
      const run = runs.find((x) => x.checklistId === l.id && (l.kind === 'onboarding' ? x.subjectUserId === me : x.day === today(c)));
      const onboarding = l.kind === 'onboarding' ? runs.filter((x) => x.checklistId === l.id).map((x) => ({ userId: x.subjectUserId, done: Object.keys(x.checks).length, completedAt: x.completedAt })) : undefined;
      return { ...l, done: run ? Object.keys(run.checks).length : 0, total: l.items.length, completedAt: run?.completedAt ?? null, ...(onboarding && actorCan(c, 'items.manage') ? { onboarding } : {}) };
    });
  });

  r.post(`${base}/checklists`, { ...ck, perm: 'items.manage', summary: 'Create a checklist (opening, closing, onboarding…)', body: schemas.checklistCreate }, async (c, { body }) => {
    const group = c.get('group');
    const [l] = await db.insert(checklists).values({ id: newId(), groupId: group.id, title: body.title, kind: body.kind, items: body.items.map((it, i) => ({ id: `i${i + 1}`, ...it })), createdBy: c.get('user').id, createdAt: deps.clock() }).returning();
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'checklists' });
    return l;
  });

  r.get(`${base}/checklists/:checklistId/run`, { ...ck, perm: 'items.read', summary: 'Today’s run (daily lists) or an onboarding run' }, async (c) => {
    const l = await loadList(c);
    return { checklist: l, run: await runFor(c, l) };
  });

  r.get(`${base}/checklists/:checklistId/history`, { ...ck, perm: 'items.manage', summary: 'Past runs with who checked what and when' }, async (c) => {
    const l = await loadList(c);
    return db.select().from(checklistRuns).where(eq(checklistRuns.checklistId, l.id)).orderBy(desc(checklistRuns.createdAt)).limit(60);
  });

  r.post(`${base}/checklists/:checklistId/items/:itemId/check`, { ...ck, perm: 'items.read', summary: 'Tick an item (time-stamped; photo proof where the item asks for it)', body: schemas.checklistCheck }, async (c, { body }) => {
    const group = c.get('group');
    const user = c.get('user');
    const res = await db.transaction(async (tx) => {
      const l = await loadList(c, tx);
      const item = l.items.find((i) => i.id === c.req.param('itemId'));
      if (!item) throw notFound();
      if (item.photo && !body.photoFileId) throw badRequest('photo_required');
      if (body.photoFileId) {
        const [f] = await tx.select().from(files).where(and(eq(files.id, body.photoFileId), eq(files.groupId, group.id)));
        if (!f || !f.uploadedAt || !f.mime.startsWith('image/')) throw badRequest('bad_file');
      }
      const run = await runFor(c, l, tx);
      const [locked] = await tx.select().from(checklistRuns).where(eq(checklistRuns.id, run.id)).for('update');
      if (locked.checks[item.id]) throw conflict('already_checked');
      const checks = { ...locked.checks, [item.id]: { at: deps.clock().toISOString(), by: user.id, photoFileId: body.photoFileId ?? null } };
      const complete = l.items.every((i) => checks[i.id]);
      const [row] = await tx.update(checklistRuns).set({ checks, completedAt: complete ? deps.clock() : null }).where(eq(checklistRuns.id, run.id)).returning();
      if (complete) {
        await logActivity(tx, { groupId: group.id, actorId: user.id, verb: 'completed', entity: 'checklist', entityId: l.id, summary: l.title });
        const managers = (await tx.select({ u: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, group.id))).filter((m) => ['owner', 'admin', 'manager'].includes(m.role) && m.u !== user.id);
        await notify(tx, { userIds: managers.map((m) => m.u), groupId: group.id, kind: 'checklist_done', title: `☑️ ${l.title}`, body: `Completed by ${c.get('member').displayName}`, data: { href: `/g/${group.id}/checklists` }, push: false, now: deps.clock() });
      }
      return row;
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'checklists' });
    return res;
  });

  r.delete(`${base}/checklists/:checklistId`, { ...ck, perm: 'items.manage', summary: 'Archive a checklist' }, async (c) => {
    const l = await loadList(c);
    await db.update(checklists).set({ active: false }).where(eq(checklists.id, l.id));
    emit(c, { type: 'invalidate', groupId: l.groupId, entity: 'checklists' });
    return { ok: true };
  });
}
