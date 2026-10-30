import { schemas } from '@circle/shared';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/client';
import { groupMembers, groups, users } from '../db/schema';
import type { Deps } from '../deps';
import { logActivity } from '../effects';
import { forbidden, notFound } from '../errors';
import { emit, type Ctx, type Router } from '../http';
import { assertSeat } from '../entitlements';
import { newId } from '../ids';

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function checkPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const got = scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 15 * 60_000;

/** Better Auth plugin: a Child signs in with a PIN on a shared device (no email, A11). */
export function childPinPlugin(db: DB, clock: () => Date) {
  return {
    id: 'child-pin',
    endpoints: {
      childSignIn: createAuthEndpoint('/child/sign-in', { method: 'POST', body: z.object({ childId: z.string().min(1).max(64), pin: z.string().min(1).max(12) }) }, async (ctx) => {
        const [u] = await db.select().from(users).where(and(eq(users.id, ctx.body.childId), eq(users.isChild, true)));
        if (!u || !u.pinHash) throw new APIError('UNAUTHORIZED', { message: 'wrong_pin' });
        const now = clock();
        if (u.pinLockedUntil && u.pinLockedUntil > now) throw new APIError('TOO_MANY_REQUESTS', { message: 'locked' });
        if (!checkPin(ctx.body.pin, u.pinHash)) {
          const failed = u.pinFailed + 1;
          await db
            .update(users)
            .set(failed >= PIN_MAX_FAILURES ? { pinFailed: 0, pinLockedUntil: new Date(now.getTime() + PIN_LOCK_MS) } : { pinFailed: failed })
            .where(eq(users.id, u.id));
          throw new APIError('UNAUTHORIZED', { message: 'wrong_pin' });
        }
        await db.update(users).set({ pinFailed: 0, pinLockedUntil: null }).where(eq(users.id, u.id));
        const session = await ctx.context.internalAdapter.createSession(u.id);
        const user = await ctx.context.internalAdapter.findUserById(u.id);
        if (!session || !user) throw new APIError('INTERNAL_SERVER_ERROR');
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ token: session.token, user: { id: user.id, name: user.name, isChild: true } });
      }),
    },
  } as const;
}

/** Children have no links outside the family: they can't create or join groups (A11). */
export function assertNotChild(c: Ctx) {
  if ((c.get('user') as { isChild?: boolean }).isChild) throw forbidden('child_account');
}

export function registerChildRoutes(r: Router, deps: Deps) {
  const { db } = deps;

  r.post('/groups/:groupId/children', { perm: 'group.settings', tags: ['children'], summary: 'A parent creates a Child account in this group', body: schemas.childCreate }, async (c, { body }) => {
    assertNotChild(c);
    const group = c.get('group');
    const parent = c.get('user');
    const id = newId();
    await db.transaction(async (tx) => {
      await assertSeat(tx, group.id, deps.clock()); // children take a seat too (v2.4)
      await tx.insert(users).values({
        id,
        name: body.name,
        email: `child-${id}@child.circle.invalid`,
        emailVerified: false,
        isChild: true,
        managedBy: parent.id,
        pinHash: hashPin(body.pin),
        language: parent.language ?? 'en',
        digits: parent.digits ?? 'latn',
        timezone: parent.timezone ?? group.timezone,
      });
      await tx.insert(groupMembers).values({ groupId: group.id, userId: id, role: 'child', displayName: body.name });
      await logActivity(tx, { groupId: group.id, actorId: parent.id, verb: 'joined', entity: 'member', entityId: id, summary: `${body.name} (child)` });
    });
    emit(c, { type: 'invalidate', groupId: group.id, entity: 'members' });
    return { id, name: body.name };
  });

  r.get('/me/children', { tags: ['children'], summary: 'Child accounts I manage' }, async (c) => {
    const kids = await db.select({ id: users.id, name: users.name, image: users.image }).from(users).where(and(eq(users.managedBy, c.get('user').id), eq(users.isChild, true)));
    if (!kids.length) return [];
    const memberships = await db
      .select({ userId: groupMembers.userId, groupId: groups.id, name: groups.name, emoji: groups.emoji })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(inArray(groupMembers.userId, kids.map((k) => k.id)));
    return kids.map((k) => ({ ...k, groups: memberships.filter((m) => m.userId === k.id) }));
  });

  async function myChild(c: Ctx) {
    const [kid] = await db.select().from(users).where(and(eq(users.id, c.req.param('childId')!), eq(users.isChild, true), eq(users.managedBy, c.get('user').id)));
    if (!kid) throw notFound();
    return kid;
  }

  r.post('/me/children/:childId/pin', { tags: ['children'], summary: 'Reset a Child’s PIN', body: schemas.childPin }, async (c, { body }) => {
    const kid = await myChild(c);
    await db.update(users).set({ pinHash: hashPin(body.pin), pinFailed: 0, pinLockedUntil: null }).where(eq(users.id, kid.id));
    return { ok: true };
  });

  r.delete('/me/children/:childId', { tags: ['children'], summary: 'Delete a Child account' }, async (c) => {
    const kid = await myChild(c);
    await db.delete(users).where(eq(users.id, kid.id));
    return { ok: true };
  });
}
