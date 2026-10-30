import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGrantCli } from '../src/admin/grant';
import { createDb } from '../src/db/client';
import { entitlements, groupMembers, groups, notifications } from '../src/db/schema';
import { join, makeGroup, setup, type Client, type TestApp } from './helpers';

let t: TestApp;
let owner: Client;
let g: { id: string; code: string; group: any };
const joiners: Client[] = [];

beforeAll(async () => {
  t = await setup();
  owner = await t.signIn('owner@example.com', 'Owner');
  g = await makeGroup(owner, 'sport', 'Big Sunday League');
  for (let i = 1; i <= 14; i++) {
    const u = await t.signIn(`p${i}@example.com`, `Player ${i}`);
    await join(u, g.code);
    joiners.push(u);
  }
});
afterAll(() => t.close());

const memberCount = async () => (await t.db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id))).length;

describe('Free plan member cap (B9 v2.4)', () => {
  it('the 16th member joining a Free group is rejected with an upgrade error; nothing is saved; organizers are told', async () => {
    expect(await memberCount()).toBe(15);
    const late = await t.signIn('sixteen@example.com', 'Sixteen');
    const preview = await late.get(`/api/invites/${g.code}`);
    expect(preview.body).toMatchObject({ memberCount: 15, memberLimit: 15, full: true });
    const res = await late.post(`/api/invites/${g.code}/join`);
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ error: 'upgrade_required', details: { plan: 'free', limit: 15, upgradeTo: 'group_pro' } });
    expect(await memberCount()).toBe(15);
    expect((await late.get('/api/groups')).body.find((x: any) => x.id === g.id)).toBeUndefined();
    const told = await t.db.select().from(notifications).where(eq(notifications.kind, 'group_full'));
    expect(told.map((n) => n.userId)).toEqual([owner.user.id]);
    expect((await owner.get(`/api/groups/${g.id}/plan`)).body).toMatchObject({ plan: 'free', limit: 15, members: 15, full: true });
  });

  it('a child takes a seat too', async () => {
    const res = await owner.post(`/api/groups/${g.id}/children`, { name: 'Lina', pin: '1234' });
    expect(res.status).toBe(402);
    expect(await memberCount()).toBe(15);
  });
});

describe('Group Pro (B9 v2.4)', () => {
  it('granted by the admin CLI, Group Pro lifts the limit to 100; when it lapses new joins stop but nobody is removed', async () => {
    const out = await runGrantCli(t.db, ['--group', g.id, '--plan', 'group_pro', '--days', '30', '--note', 'pilot'], t.now());
    expect(out[0]).toContain('granted group_pro');
    expect((await owner.get(`/api/groups/${g.id}/plan`)).body).toMatchObject({ plan: 'group_pro', limit: 100, members: 15, full: false });
    const sixteen = await t.signIn('sixteen@example.com', 'Sixteen');
    expect((await sixteen.post(`/api/invites/${g.code}/join`)).status).toBe(200);
    const seventeen = await t.signIn('seventeen@example.com', 'Seventeen');
    expect((await seventeen.post(`/api/invites/${g.code}/join`)).status).toBe(200);
    expect(await memberCount()).toBe(17);

    t.advance(31 * 86_400_000);
    expect((await owner.get(`/api/groups/${g.id}/plan`)).body).toMatchObject({ plan: 'free', limit: 15, members: 17, full: true });
    const eighteen = await t.signIn('eighteen@example.com', 'Eighteen');
    expect((await eighteen.post(`/api/invites/${g.code}/join`)).status).toBe(402);
    expect(await memberCount()).toBe(17);
  });

  it('revoke and list; Plus is a personal plan; bad input is refused', async () => {
    const [row] = (await runGrantCli(t.db, ['--group', g.id, '--plan', 'group_pro'], t.now()))[0].match(/\(([^)]+)\)/)!.slice(1);
    expect((await owner.get(`/api/groups/${g.id}/plan`)).body.plan).toBe('group_pro');
    expect((await runGrantCli(t.db, ['--revoke', row], t.now()))[0]).toContain('revoked');
    expect((await owner.get(`/api/groups/${g.id}/plan`)).body.plan).toBe('free');
    expect((await runGrantCli(t.db, ['--list', '--group', g.id], t.now())).join('\n')).toContain('REVOKED');

    expect((await owner.get('/api/me/plan')).body).toEqual({ plus: false, expiresAt: null });
    await runGrantCli(t.db, ['--user', 'owner@example.com', '--plan', 'plus', '--days', '365'], t.now());
    expect((await owner.get('/api/me/plan')).body.plus).toBe(true);
    // a personal plan doesn't lift a group's cap
    expect((await owner.get(`/api/groups/${g.id}/plan`)).body.limit).toBe(15);

    await expect(runGrantCli(t.db, ['--group', g.id, '--plan', 'plus'])).rejects.toThrow(/user plan/);
    await expect(runGrantCli(t.db, ['--group', g.id, '--plan', 'free'])).rejects.toThrow();
    await expect(runGrantCli(t.db, ['--group', 'nope', '--plan', 'group_pro'])).rejects.toThrow(/no group/);
    await expect(runGrantCli(t.db, ['--group', g.id, '--user', owner.user.id, '--plan', 'group_pro'])).rejects.toThrow(/exactly one/);
    await expect(runGrantCli(t.db, ['--group', g.id, '--plan', 'group_pro', '--days', '-3'])).rejects.toThrow(/days/);
  });

  it('the catalog is public and shows Plus and Group Pro for sale', async () => {
    const res = await t.raw('GET', '/api/plans');
    const plans = await res.json();
    expect(plans.filter((p: any) => p.sold).map((p: any) => p.id).sort()).toEqual(['group_pro', 'plus']);
  });
});

describe('no client route can grant an entitlement (B9 v2.4)', () => {
  it('every route, called by a group owner with grant-shaped bodies, leaves the entitlements table untouched', async () => {
    const before = await t.db.select().from(entitlements);
    const sweeper = await t.signIn('sweeper@example.com', 'Sweeper');
    const sg = await makeGroup(sweeper, 'custom', 'Sweep group');
    const payload = { plan: 'group_pro', scope: 'group', subjectId: sg.id, groupId: sg.id, userId: sweeper.user.id, entitlement: 'group_pro', plus: true, days: 3650, source: 'admin', productId: 'group_pro_monthly', role: 'owner' };
    const qs = `?plan=group_pro&groupId=${sg.id}&scope=group`;
    const seen = new Set<string>();
    const routes = t.app.routes
      .filter((r) => r.method !== 'ALL' && !r.path.includes('*'))
      .filter((r) => (seen.has(`${r.method} ${r.path}`) ? false : (seen.add(`${r.method} ${r.path}`), true)))
      .sort((a, b) => Number(a.method === 'DELETE') - Number(b.method === 'DELETE'));
    expect(routes.length).toBeGreaterThan(150);
    for (const r of routes) {
      const path = r.path.replace(':groupId', sg.id).replace(/:[A-Za-z]+/g, 'x') + qs;
      await sweeper.req(r.method, path, r.method === 'GET' ? undefined : payload);
    }
    // Better Auth's own endpoints too (profile update with extra fields)
    for (const p of ['/api/auth/update-user', '/api/auth/sign-in/email-otp', '/api/auth/email-otp/send-verification-otp']) await sweeper.req('POST', p, payload);
    expect(await t.db.select().from(entitlements)).toEqual(before);
  });

  it('no write route is about plans, and only the admin CLI calls the grant functions', () => {
    const writes = t.app.routes.filter((r) => !['GET', 'ALL', 'HEAD', 'OPTIONS'].includes(r.method) && /plan|entitle|subscri|purchase|revenuecat/i.test(r.path));
    expect(writes).toEqual([]);
    const src = joinPath(__dirname, '../src');
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((f) => (statSync(joinPath(dir, f)).isDirectory() ? walk(joinPath(dir, f)) : f.endsWith('.ts') ? [joinPath(dir, f)] : []));
    })(src);
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      const rel = f.slice(src.length + 1);
      if (rel === 'entitlements.ts' || rel === 'admin/grant.ts' || rel === 'db/schema.ts') return false;
      return /(insert|update|delete)\(entitlements\)|grantEntitlement|revokeEntitlement/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe('the CLI script itself', () => {
  it('grants a plan in a PGlite data directory, and refuses to run without a database', async () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'circle-cli-'));
    const { db, close } = await createDb({ dataDir: dir });
    await db.insert(groups).values({ id: 'g_cli', type: 'sport', name: 'CLI group', createdBy: 'u_admin' });
    await close();
    const run = promisify(execFile);
    const cwd = joinPath(__dirname, '..');
    const ok = await run('npx', ['tsx', 'scripts/grant-entitlement.ts', '--group', 'g_cli', '--plan', 'group_pro', '--data-dir', dir], { cwd, env: { ...process.env, DATABASE_URL: '' } });
    expect(ok.stdout).toContain('granted group_pro to group g_cli');
    const again = await createDb({ dataDir: dir });
    expect((await again.db.select().from(entitlements)).map((e) => e.plan)).toEqual(['group_pro']);
    await again.close();
    await expect(run('npx', ['tsx', 'scripts/grant-entitlement.ts', '--group', 'g_cli', '--plan', 'group_pro'], { cwd, env: { ...process.env, DATABASE_URL: '', PGLITE_DIR: '' } })).rejects.toMatchObject({ code: 2 });
  }, 60_000);
});
