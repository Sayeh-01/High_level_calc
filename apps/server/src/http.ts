import { can, type GroupPolicy, type Permission, type Role } from '@circle/shared';
import { and, eq } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Auth } from './auth';
import type { BusMessage } from './bus';
import { groupMembers, groups } from './db/schema';
import type { Deps } from './deps';
import { HttpError, badRequest, forbidden, notFound } from './errors';

export type GroupRow = typeof groups.$inferSelect;
export type MemberRow = typeof groupMembers.$inferSelect;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  language?: string;
  digits?: string;
  timezone?: string;
  isChild?: boolean;
}

/** Who is calling a group route. Users are members; later versions add guest tokens, vendors and API keys. */
export interface Actor {
  kind: 'member' | 'guest' | 'apikey';
  userId: string | null;
  role: Role;
  customRoleId: string | null;
  /** Narrower scope for guests / API keys: which entity ids they may touch. Null = no extra restriction. */
  scope: { entity: string; id: string }[] | null;
}

export type AppEnv = {
  Variables: {
    user: SessionUser;
    group: GroupRow;
    member: MemberRow;
    actor: Actor;
    pending: BusMessage[];
    userEvents: { userId: string; msg: BusMessage }[];
  };
};
export type Ctx = Context<AppEnv>;

export interface RouteMeta {
  method: string;
  path: string;
  summary?: string;
  perm?: Permission;
  module?: string;
  body?: z.ZodType;
  query?: z.ZodType;
  auth: 'user' | 'public';
  tags?: string[];
}

export interface RouteOpts<B extends z.ZodType | undefined, Q extends z.ZodType | undefined> {
  summary?: string;
  /** Permission required on the group (default group.read for any /groups/:groupId route). */
  perm?: Permission;
  /** Module that must be switched on in the group. */
  module?: string;
  body?: B;
  query?: Q;
  auth?: 'user' | 'public';
  tags?: string[];
}

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;
type Handler<B extends z.ZodType | undefined, Q extends z.ZodType | undefined> = (
  c: Ctx,
  input: { body: Infer<B>; query: Infer<Q> },
) => Promise<unknown> | unknown;

export function policyOf(group: GroupRow): GroupPolicy {
  return (group.settings ?? {}) as GroupPolicy;
}

export function actorCan(c: Ctx, permission: Permission): boolean {
  const actor = c.get('actor');
  return can(actor.role, permission, policyOf(c.get('group')), actor.customRoleId);
}

/** Emit a realtime invalidation after the handler (and its transaction) has finished. */
export function emit(c: Ctx, msg: BusMessage) {
  c.get('pending').push(msg);
}
export function emitUser(c: Ctx, userId: string, msg: BusMessage) {
  c.get('userEvents').push({ userId, msg });
}

export function requireUserMw(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new HttpError(401, 'unauthenticated');
    c.set('user', session.user as SessionUser);
    await next();
  };
}

/**
 * The single authorization choke point for group routes (B6).
 * Non-members get 404 (the group's existence is not revealed); members without the permission get 403.
 */
export function requireMemberMw(deps: Deps, permission: Permission, module?: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const groupId = c.req.param('groupId');
    const user = c.get('user');
    if (!groupId || !user) throw notFound();
    const [row] = await deps.db
      .select({ group: groups, member: groupMembers })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
      .limit(1);
    if (!row) throw notFound();
    c.set('group', row.group);
    c.set('member', row.member);
    const actor: Actor = {
      kind: 'member',
      userId: user.id,
      role: row.member.role as Role,
      customRoleId: row.member.customRoleId,
      scope: null,
    };
    c.set('actor', actor);
    if (module && !row.group.modules.includes(module)) throw notFound('module_off');
    if (!can(actor.role, permission, policyOf(row.group), actor.customRoleId)) throw forbidden();
    await next();
  };
}

async function parseBody<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest('invalid_json');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest('validation_error', 'Invalid request body', z.treeifyError(parsed.error));
  return parsed.data;
}

function parseQuery<T extends z.ZodType>(c: Ctx, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw badRequest('validation_error', 'Invalid query', z.treeifyError(parsed.error));
  return parsed.data;
}

export function createRouter(deps: Deps, auth: Auth) {
  const app = new Hono<AppEnv>();
  const requireUser = requireUserMw(auth);
  const registry: RouteMeta[] = [];

  function add<B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts: RouteOpts<B, Q>,
    handler: Handler<B, Q>,
  ) {
    const mws: MiddlewareHandler<AppEnv>[] = [];
    const authMode = opts.auth ?? 'user';
    if (authMode === 'user') mws.push(requireUser);
    if (path.includes(':groupId')) mws.push(requireMemberMw(deps, opts.perm ?? 'group.read', opts.module));
    registry.push({ method, path: `/api${path}`, summary: opts.summary, perm: opts.perm, module: opts.module, body: opts.body, query: opts.query, auth: authMode, tags: opts.tags });
    const final: MiddlewareHandler<AppEnv> = async (c) => {
      c.set('pending', []);
      c.set('userEvents', []);
      const body = (opts.body ? await parseBody(c, opts.body) : undefined) as Infer<B>;
      const query = (opts.query ? parseQuery(c, opts.query) : undefined) as Infer<Q>;
      const out = await handler(c, { body, query });
      for (const msg of c.get('pending')) deps.bus.publish(msg);
      for (const { userId, msg } of c.get('userEvents')) deps.bus.publishUser(userId, msg);
      if (out instanceof Response) return out;
      return c.json(out ?? { ok: true });
    };
    (app.on as (m: string, p: string, ...h: MiddlewareHandler<AppEnv>[]) => unknown)(method, path, ...mws, final);
  }

  return {
    app,
    registry,
    requireUser,
    get: <Q extends z.ZodType | undefined = undefined>(p: string, o: RouteOpts<undefined, Q>, h: Handler<undefined, Q>) => add('GET', p, o, h),
    post: <B extends z.ZodType | undefined = undefined>(p: string, o: RouteOpts<B, undefined>, h: Handler<B, undefined>) => add('POST', p, o, h),
    patch: <B extends z.ZodType | undefined = undefined>(p: string, o: RouteOpts<B, undefined>, h: Handler<B, undefined>) => add('PATCH', p, o, h),
    put: <B extends z.ZodType | undefined = undefined>(p: string, o: RouteOpts<B, undefined>, h: Handler<B, undefined>) => add('PUT', p, o, h),
    delete: (p: string, o: RouteOpts<undefined, undefined>, h: Handler<undefined, undefined>) => add('DELETE', p, o, h),
  };
}

export type Router = ReturnType<typeof createRouter>;
