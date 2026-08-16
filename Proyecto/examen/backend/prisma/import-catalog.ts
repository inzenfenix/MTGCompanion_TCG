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
  set_type: string | null;
  frame: string | number | null;
  border_color: string | null;
  color_identity: string[] | null;
  finishes: string[] | null;
  frame_effects: string[] | null;
  released_at: string | null;
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
    let processed = 0;

    for (const batch of chunk(deduped, BATCH_SIZE)) {
      // Upsert, not createMany({skipDuplicates}) — see this file's header
      // comment on why (backfilling E3b's new columns onto already-imported
      // rows). $transaction pipelines the batch's statements together
      // rather than one round-trip per row.
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
      );
      processed += batch.length;
      process.stdout.write(`\r  processed ${processed}/${deduped.length}`);
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
