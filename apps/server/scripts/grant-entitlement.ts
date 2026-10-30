// Admin CLI: the only way to grant a plan in dev (B4). See src/admin/grant.ts for usage.
import { runGrantCli, USAGE } from '../src/admin/grant';
import { createDb } from '../src/db/client';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const dataDirIdx = argv.indexOf('--data-dir');
const dataDir = dataDirIdx >= 0 ? argv[dataDirIdx + 1] : process.env.PGLITE_DIR;
if (!process.env.DATABASE_URL && !dataDir && !argv.includes('--help')) {
  console.error('Set DATABASE_URL or PGLITE_DIR (or pass --data-dir): an in-memory database would forget the grant.\n\n' + USAGE);
  process.exit(2);
}
const { db, close } = await createDb({ url: process.env.DATABASE_URL, dataDir });
try {
  for (const line of await runGrantCli(db, argv)) console.log(line);
} catch (e) {
  console.error(`error: ${(e as Error).message}\n\n${USAGE}`);
  process.exitCode = 1;
} finally {
  await close();
}
