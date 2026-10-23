// `npm run test:e2e:embedded` (ROADMAP.md O14) — the same e2e suites as
// `npm run test:e2e`, but against a throwaway PostgreSQL 16 started from
// the `embedded-postgres` dev dependency instead of docker/dev.sh's
// container. For machines with no Docker (it was written on one). Nothing
// gets installed system-wide: binaries come from node_modules, data lives
// in a temp dir deleted on teardown.
//
// Plain .mjs on purpose: embedded-postgres is ESM-only and Jest loads an
// .mjs globalSetup with a native import(), no transform involved.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const DB = 'mtg_e2e';

export default async function globalSetup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'mtg-e2e-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'mtg',
    password: 'mtg',
    port: PORT,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  globalThis.__EMBEDDED_PG__ = pg;

  // Jest workers (and the runInBand test context) inherit process.env from
  // here. Keys are random per run — tests never depend on a fixed key, and
  // no real key ever has to be on this machine for them to pass.
  process.env.DATABASE_URL = `postgresql://mtg:mtg@localhost:${PORT}/${DB}?schema=public`;
  process.env.FIELD_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
  process.env.PSEUDONYM_KEY ||= randomBytes(32).toString('base64');
  process.env.NODE_ENV ||= 'test';
  // Lets suites that would be destructive on a real dev database (the
  // anonymizer, creating DB roles) know they're on a throwaway one.
  process.env.E2E_EMBEDDED_DB = '1';

  execSync('npx prisma migrate deploy --config prisma.config.ts', {
    stdio: 'ignore',
    env: process.env,
  });
}
