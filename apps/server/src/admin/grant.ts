import { PLAN_IDS, PLANS, type PlanId } from '@circle/shared';
import { and, eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import type { DbOrTx } from '../db/client';
import { entitlements, groups, users } from '../db/schema';
import { grantEntitlement, revokeEntitlement } from '../entitlements';

export const USAGE = `Grant or revoke a plan (the only way to grant one; B4).

  pnpm --filter @circle/server grant -- --group <groupId> --plan group_pro [--days 30] [--note "..."]
  pnpm --filter @circle/server grant -- --user <userId|email> --plan plus [--days 30]
  pnpm --filter @circle/server grant -- --list [--group <id> | --user <id|email>]
  pnpm --filter @circle/server grant -- --revoke <entitlementId>

Database: DATABASE_URL (Postgres) or PGLITE_DIR / --data-dir (PGlite), same as the server.
Plans: ${PLAN_IDS.filter((p) => p !== 'free').join(', ')}`;

/** Parses argv and runs one admin command. Returns the lines to print. Throws on bad input. */
export async function runGrantCli(db: DbOrTx, argv: string[], now = new Date()): Promise<string[]> {
  const { values } = parseArgs({
    args: argv,
    options: {
      group: { type: 'string' },
      user: { type: 'string' },
      plan: { type: 'string' },
      days: { type: 'string' },
      note: { type: 'string' },
      revoke: { type: 'string' },
      list: { type: 'boolean' },
      'data-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) return [USAGE];

  const resolveUser = async (v: string) => {
    const [u] = await db.select().from(users).where(v.includes('@') ? eq(users.email, v.toLowerCase()) : eq(users.id, v));
    if (!u) throw new Error(`no user ${v}`);
    if (u.isChild) throw new Error('child accounts cannot hold a plan');
    return u.id;
  };
  const resolveGroup = async (v: string) => {
    const [g] = await db.select().from(groups).where(eq(groups.id, v));
    if (!g) throw new Error(`no group ${v}`);
    return g.id;
  };

  if (values.revoke) {
    const row = await revokeEntitlement(db, values.revoke, now);
    if (!row) throw new Error(`no entitlement ${values.revoke}`);
    return [`revoked ${row.id} (${row.plan} for ${row.scope} ${row.subjectId})`];
  }

  if (values.list) {
    const conds = [];
    if (values.group) conds.push(eq(entitlements.scope, 'group'), eq(entitlements.subjectId, await resolveGroup(values.group)));
    if (values.user) conds.push(eq(entitlements.scope, 'user'), eq(entitlements.subjectId, await resolveUser(values.user)));
    const rows = await db.select().from(entitlements).where(conds.length ? and(...conds) : undefined);
    return rows.length
      ? rows.map((e) => `${e.id}  ${e.plan.padEnd(10)} ${e.scope} ${e.subjectId}  from ${e.startsAt.toISOString()}  ${e.expiresAt ? `until ${e.expiresAt.toISOString()}` : 'no end'}${e.revokedAt ? '  REVOKED' : ''}`)
      : ['no entitlements'];
  }

  const plan = values.plan as PlanId | undefined;
  if (!plan || !PLANS[plan] || plan === 'free') throw new Error(`--plan must be one of: ${PLAN_IDS.filter((p) => p !== 'free').join(', ')}`);
  if (!!values.group === !!values.user) throw new Error('give exactly one of --group or --user');
  const days = values.days ? Number(values.days) : null;
  if (days !== null && (!Number.isInteger(days) || days <= 0)) throw new Error('--days must be a positive whole number');
  const scope = values.group ? 'group' : 'user';
  const subjectId = values.group ? await resolveGroup(values.group) : await resolveUser(values.user!);
  const row = await grantEntitlement(db, { scope, subjectId, plan, days, source: 'admin', grantedBy: `cli:${process.env.USER ?? 'admin'}`, note: values.note, now });
  return [`granted ${row.plan} to ${scope} ${subjectId} (${row.id})${row.expiresAt ? ` until ${row.expiresAt.toISOString()}` : ''}`];
}
