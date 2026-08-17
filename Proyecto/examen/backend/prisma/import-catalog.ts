/**
 * Bulk-imports the Scryfall-derived card catalog (ROADMAP.md workstream F,
 * item F6) from certamen_1/data/cards.json into the `catalog_cards` table so
 * the Bazaar (TabSearch.tsx, E6) can search real card names/printings
 * instead of only whatever titles users have typed into their own listings.
 *
 * Additive/idempotent by design, same rule CLAUDE.md applies to
 * `shared-downloader` vs. `shared-scraper`: this NEVER truncates or deletes
 * existing catalog_cards rows. Safe to re-run after a fresh scrape.
 *
 * Upserts, not `createMany({skipDuplicates:true})` — changed for ROADMAP.md
 * E3b, which added 7 new columns (setType/frame/borderColor/colorIdentity/
 * finishes/frameEffects/releasedAt) that the original 58,679-row import
 * predates. `skipDuplicates` would have silently left every existing row's
 * new columns null forever; upserting backfills them on a re-run while
 * still being purely additive (never deletes, and a matching id just gets
 * its fields refreshed from the source file — same idempotency guarantee,
 * stronger than before since it now also self-heals a corrected upstream
 * field instead of ignoring it).
 *
 * Run: npm run db:import-catalog
 *      npm run db:import-catalog -- --file /path/to/other/cards.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';

// ROADMAP.md I39 — real bug found live, on the actual production run: a
// batch of 2000 upserts wrapped in ONE Prisma interactive transaction blew
// past Prisma's default 5000ms transaction timeout against the real
// deployed RDS instance (network latency + 2000 upsert round-trips genuinely
// take longer than 5s there, unlike a local dev DB) — `P2028: Transaction
// API error: A rollback cannot be executed on an expired transaction`. The
// whole script then crashed (uncaught rejection -> `process.exit(1)` in
// `main().catch()`), having only processed 16,000/58,679 rows — silently
// leaving the live catalog missing everything after that point (a real
// card, "Chitterspitter", was one of the casualties — confirmed missing
// from the live `/catalog/search` endpoint, confirmed present in the local
// source `cards.json`, root-caused via `aws ssm get-command-invocation`'s
// actual stderr, not guessed). Smaller batches (less time per transaction)
// + an explicit generous timeout fixes the immediate cause; per-batch
// try/catch means one slow/failing batch no longer takes down the entire
// 58k-row import — upserts are idempotent, so a re-run (or the next
// scheduled one) naturally retries whatever a transient failure skipped.
const BATCH_SIZE = 500;
const TRANSACTION_TIMEOUT_MS = 30000;

// Default source: certamen_1's scraper output. Relative to this file
// (backend/prisma/) rather than cwd, so `npm run db:import-catalog` works
// the same regardless of where it's invoked from.
const DEFAULT_SOURCE = path.resolve(
  __dirname,
  '../../../certamen_1/data/cards.json',
);

interface ScryfallCardRow {
  id: string;
  name: string;
  set: string;
  set_name: string;
  rarity: string | null;
  type_line: string | null;
  mana_cost: string | null;
  cmc: number | null;
  colors: string[] | null;
  oracle_text: string | null;
  image_url: string | null;
  edhrec_rank: number | null;
  set_type: string | null;
  frame: string | number | null;
  border_color: string | null;
  color_identity: string[] | null;
  finishes: string[] | null;
  frame_effects: string[] | null;
  released_at: string | null;
}

// ROADMAP.md I39 — `--offset`/`--limit` let the CALLER (desktop-runner's
// `importCatalog()`) split the 58,679-row file across several small, fresh
// `ts-node` process invocations instead of one long-lived one. Needed
// because the real deployed instance only has ~2GB RAM: a single process
// handling all 58,679 upserts genuinely ran out of V8 heap around row
// 24,000 (confirmed live via `aws ssm get-command-invocation`'s actual
// stderr — a real `FATAL ERROR: Reached heap limit... JavaScript heap out
// of memory`, not guessed) — Prisma/the pg adapter accumulates real memory
// across many sequential transactions in one process, and this instance
// doesn't have the headroom to raise `--max-old-space-size` instead (only
// ~1.3GB free at the time, most of it needed as safety margin, not extra
// heap for one script). A fresh process per chunk gets a fresh V8 heap
// each time — cheaper and safer than provisioning more RAM for a job that
// only needs to run occasionally. Defaults (offset=0, no limit) process
// the whole file in one call, unchanged for local/dev use.
function parseArgs(argv: string[]): { file: string; offset: number; limit: number | null } {
  const fileIdx = argv.indexOf('--file');
  const file = fileIdx !== -1 ? argv[fileIdx + 1] : DEFAULT_SOURCE;
  const offsetIdx = argv.indexOf('--offset');
  const offset = offsetIdx !== -1 ? Number(argv[offsetIdx + 1]) : 0;
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(argv[limitIdx + 1]) : null;
  return { file, offset, limit };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const { file, offset, limit } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(file)) {
    // Fail loudly rather than silently importing nothing — same honesty
    // convention as certamen_2's tabular_scaler.json gap (E2 in ROADMAP.md).
    throw new Error(
      `Catalog source not found: ${file}\n` +
        `Run certamen_1's scraper first (desktop-runner's Scraper tab, or ` +
        `01_scraper.py --max-cards 0), or pass --file <path>.`,
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env first');
  }

  console.log(`Reading catalog source: ${file}`);
  const raw = fs.readFileSync(file, 'utf-8');
  const rows: ScryfallCardRow[] = JSON.parse(raw);
  console.log(`Parsed ${rows.length} rows.`);

  // cards.json can (rarely) contain the exact same Scryfall id twice across
  // scraper runs concatenated by hand — dedupe by id before batching, since
  // a single createMany() call errors on an in-batch primary-key collision
  // (skipDuplicates only protects against collisions with rows already in
  // the table, not within the same call).
  const seen = new Set<string>();
  const deduped = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  if (deduped.length !== rows.length) {
    console.log(
      `Dropped ${rows.length - deduped.length} duplicate id(s) within the source file.`,
    );
  }

  // Dedupe against the WHOLE file first (a duplicate id could straddle a
  // chunk boundary), THEN slice to this invocation's chunk — see
  // `parseArgs`'s own comment for why chunking exists at all.
  const sliced = limit !== null ? deduped.slice(offset, offset + limit) : deduped.slice(offset);
  if (offset > 0 || limit !== null) {
    console.log(`Processing rows ${offset}-${offset + sliced.length} of ${deduped.length} (this invocation's chunk).`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const before = await prisma.catalogCard.count();
    let processed = 0;
    const failedBatches: { start: number; end: number; error: string }[] = [];

    const batches = chunk(sliced, BATCH_SIZE);
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      // Upsert, not createMany({skipDuplicates}) — see this file's header
      // comment on why (backfilling E3b's new columns onto already-imported
      // rows). $transaction pipelines the batch's statements together
      // rather than one round-trip per row. Explicit `timeout` — see
      // `TRANSACTION_TIMEOUT_MS`'s own comment for why the default 5000ms
      // isn't enough against the real deployed DB.
      try {
        await prisma.$transaction(
          batch.map((row) => {
            const data = {
              name: row.name,
              setCode: row.set,
              setName: row.set_name,
              rarity: row.rarity ?? null,
              typeLine: row.type_line ?? null,
              manaCost: row.mana_cost ?? null,
              cmc: row.cmc ?? null,
              colors: row.colors ?? [],
              oracleText: row.oracle_text ?? null,
              imageUrl: row.image_url ?? null,
              edhrecRank: row.edhrec_rank ?? null,
              setType: row.set_type ?? null,
              frame: row.frame !== null && row.frame !== undefined ? String(row.frame) : null,
              borderColor: row.border_color ?? null,
              colorIdentity: row.color_identity ?? [],
              finishes: row.finishes ?? [],
              frameEffects: row.frame_effects ?? [],
              releasedAt: row.released_at ?? null,
            };
            return prisma.catalogCard.upsert({
              where: { id: row.id },
              create: { id: row.id, ...data },
              update: data,
            });
          }),
          { timeout: TRANSACTION_TIMEOUT_MS },
        );
      } catch (err) {
        // One bad batch (a transient timeout, a lock, whatever) no longer
        // takes the entire 58k-row import down with it — upserts are
        // idempotent, so this batch's rows just get picked up on the next
        // run instead of silently vanishing along with every row after it.
        const start = batchIdx * BATCH_SIZE;
        const message = err instanceof Error ? err.message : String(err);
        failedBatches.push({ start, end: start + batch.length, error: message });
        console.error(`\nBatch ${start}-${start + batch.length} failed, continuing: ${message.split('\n')[0]}`);
      }
      processed += batch.length;
      process.stdout.write(`\r  processed ${processed}/${sliced.length}`);
    }
    console.log('');
    if (failedBatches.length > 0) {
      console.error(`${failedBatches.length} batch(es) failed (rows possibly missing, re-run to retry):`);
      for (const f of failedBatches) console.error(`  rows ${f.start}-${f.end}: ${f.error.split('\n')[0]}`);
    }

    const after = await prisma.catalogCard.count();
    console.log(
      `Done. catalog_cards: ${before} -> ${after} rows (+${after - before}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
