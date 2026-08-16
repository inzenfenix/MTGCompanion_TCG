/**
 * Bulk-imports the Scryfall-derived card catalog (ROADMAP.md workstream F,
 * item F6) from certamen_1/data/cards.json into the `catalog_cards` table so
 * the Bazaar (TabSearch.tsx, E6) can search real card names/printings
 * instead of only whatever titles users have typed into their own listings.
 *
 * Additive/idempotent by design, same rule CLAUDE.md applies to
 * `shared-downloader` vs. `shared-scraper`: this NEVER truncates or deletes
 * existing catalog_cards rows, only inserts ones that aren't there yet
 * (`skipDuplicates: true`). Safe to re-run after a fresh scrape — new
 * printings get added, nothing existing is touched or re-priced. If you
 * need to pick up field changes on already-imported rows (e.g. a corrected
 * oracle_text), that's a deliberate separate concern, not this script's job.
 *
 * Run: npm run db:import-catalog
 *      npm run db:import-catalog -- --file /path/to/other/cards.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';

const BATCH_SIZE = 2000;

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
}

function parseArgs(argv: string[]): { file: string } {
  const idx = argv.indexOf('--file');
  const file = idx !== -1 ? argv[idx + 1] : DEFAULT_SOURCE;
  return { file };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));

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

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const before = await prisma.catalogCard.count();
    let inserted = 0;
    let processed = 0;

    for (const batch of chunk(deduped, BATCH_SIZE)) {
      const result = await prisma.catalogCard.createMany({
        data: batch.map((row) => ({
          id: row.id,
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
        })),
        skipDuplicates: true,
      });
      inserted += result.count;
      processed += batch.length;
      process.stdout.write(
        `\r  processed ${processed}/${deduped.length} (${inserted} new, ${
          processed - inserted
        } already-present)`,
      );
    }
    console.log('');

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
