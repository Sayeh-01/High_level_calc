import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type DB = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * PGlite (in-process Postgres) for dev and tests; node-postgres when DATABASE_URL is set.
 * Both expose the same Drizzle query API, so the node-postgres instance is typed as DB.
 */
export async function createDb(opts: { url?: string; dataDir?: string } = {}): Promise<{ db: DB; close: () => Promise<void> }> {
  if (opts.url) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: opts.url });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as DB, close: () => pool.end() };
  }
  const client = new PGlite(opts.dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
