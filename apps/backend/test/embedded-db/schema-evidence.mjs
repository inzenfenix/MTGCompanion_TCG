// Evidence for docs/security/ACTIVIDAD_4.md §1 (ROADMAP.md O14): the
// personal-data tables' columns before and after migration
// 20261023120000_rbac_audit_minimization, read from a real PostgreSQL 16,
// plus a drift check proving schema.prisma and the migrations agree.
//
//   node test/embedded-db/schema-evidence.mjs      (from apps/backend)
//
// Throwaway database (embedded-postgres, temp dir) — touches nothing else.
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const NEW_MIGRATION = '20261023120000_rbac_audit_minimization';
const TABLES = ['users', 'user_settings', 'refresh_tokens', 'transactions', 'offers', 'audit_logs'];
const PORT = 54331;

const db = new EmbeddedPostgres({
  databaseDir: mkdtempSync(join(tmpdir(), 'mtg-evidence-pg-')),
  user: 'mtg',
  password: 'mtg',
  port: PORT,
  persistent: false,
  onLog: () => {},
});
await db.initialise();
await db.start();
const url = (name) => `postgresql://mtg:mtg@localhost:${PORT}/${name}?schema=public`;

async function columns(name) {
  const c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  const { rows } = await c.query(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position`,
    [TABLES],
  );
  await c.end();
  const byTable = {};
  for (const r of rows) {
    (byTable[r.table_name] ??= []).push(
      `${r.column_name} ${r.data_type}${r.is_nullable === 'YES' ? ' (nullable)' : ''}`,
    );
  }
  return byTable;
}

// "Before": every migration's SQL except the new one, applied in order.
await db.createDatabase('before_o14');
const beforeDb = new pg.Client({ connectionString: url('before_o14') });
await beforeDb.connect();
const migrations = readdirSync('prisma/migrations')
  .filter((d) => /^[0-9]+_/.test(d))
  .sort();
for (const m of migrations) {
  if (m === NEW_MIGRATION) continue;
  await beforeDb.query(readFileSync(join('prisma/migrations', m, 'migration.sql'), 'utf8'));
}
await beforeDb.end();

// "After": the real deploy path (prisma migrate deploy, every migration).
await db.createDatabase('after_o14');
execSync('npx prisma migrate deploy --config prisma.config.ts', {
  stdio: 'ignore',
  env: { ...process.env, DATABASE_URL: url('after_o14') },
});

const [b, a] = [await columns('before_o14'), await columns('after_o14')];
console.log(`# Columnas antes / después de ${NEW_MIGRATION}`);
console.log('# (PostgreSQL 16, information_schema.columns; "+" = columna nueva, "-" = eliminada)\n');
for (const t of TABLES) {
  const bt = b[t] ?? [];
  const at = a[t] ?? [];
  console.log(`## ${t}${bt.length ? '' : '  (tabla NUEVA)'}`);
  for (const col of at) console.log(`  ${bt.includes(col) ? ' ' : '+'} ${col}`);
  for (const col of bt) if (!at.includes(col)) console.log(`  - ${col}`);
  console.log('');
}

let drift = 'sin diferencias (exit 0)';
try {
  execSync('npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url('after_o14') },
  });
} catch (e) {
  drift = `DIFERENCIAS (exit ${e.status}):\n${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
}
console.log(`# Drift migraciones <-> schema.prisma: ${drift}`);

await db.stop();
