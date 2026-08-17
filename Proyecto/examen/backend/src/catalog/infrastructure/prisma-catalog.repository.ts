import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CatalogRepository } from '../domain/catalog.repository';
import type { CatalogCardEntity } from '../domain/catalog-card.entity';

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Plain `contains`/insensitive first — cheap, indexed, and exactly right
  // for a real/well-formed query (still every printing's real name shown
  // to a user in Bazaar search, F6's original use case). Ordering/shape
  // unchanged from before this migration.
  //
  // ROADMAP.md I19/I21 — falls back to pg_trgm similarity() ONLY when
  // `contains` finds literally nothing, rather than blending fuzzy results
  // into every search: real on-device testing found `contains` has zero
  // tolerance for an OCR-misread name ("Moonstone Fuloyist" for the real
  // "Moonstone Eulogist" — not a substring of it at all), which is exactly
  // the case `identifyCard.ts`'s scan-to-identify flow needs a fallback
  // for. Kept as a strict fallback (not merged into the primary query) so
  // an unambiguous, well-matched query — e.g. Bazaar's "Lightning Bolt" —
  // keeps returning ONLY real substring matches, not diluted by loosely-
  // related trigram-similar cards once real matches run out.
  async search(query: string, limit: number): Promise<CatalogCardEntity[]> {
    const exact = await this.prisma.catalogCard.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      orderBy: [
        { edhrecRank: { sort: 'asc', nulls: 'last' } },
        { name: 'asc' },
      ],
      take: limit,
    });
    if (exact.length > 0) return exact;

    // 0.2 is a starting threshold, not measured against a real corpus of
    // OCR misreads — "Moonstone Fuloyist"/"Moonstone Eulogist" scores well
    // above it (shared "Moonstone " prefix alone contributes several
    // matching trigrams). Revisit if real usage shows it's too loose/tight.
    const SIMILARITY_THRESHOLD = 0.2;
    return this.prisma.$queryRaw<CatalogCardEntity[]>`
      SELECT * FROM "catalog_cards"
      WHERE similarity("name", ${query}) > ${SIMILARITY_THRESHOLD}
      ORDER BY similarity("name", ${query}) DESC, "edhrecRank" ASC NULLS LAST, "name" ASC
      LIMIT ${limit}
    `;
  }

  // ROADMAP.md I19/I25 — no `contains`-first attempt here, unlike search():
  // a raw multi-sentence OCR read matching a real oracleText character-for-
  // character as a substring is unrealistic (a short name occasionally CAN
  // read clean enough to literally contain the real string; a whole
  // paragraph of rules text essentially never will). Straight to trigram
  // similarity. Same starting threshold as search()'s own fallback, NOT
  // independently measured for this longer/noisier field — revisit if real
  // usage shows it needs its own tuning.
  async searchByText(
    query: string,
    limit: number,
  ): Promise<CatalogCardEntity[]> {
    const SIMILARITY_THRESHOLD = 0.2;
    return this.prisma.$queryRaw<CatalogCardEntity[]>`
      SELECT * FROM "catalog_cards"
      WHERE "oracleText" IS NOT NULL AND similarity("oracleText", ${query}) > ${SIMILARITY_THRESHOLD}
      ORDER BY similarity("oracleText", ${query}) DESC, "edhrecRank" ASC NULLS LAST, "name" ASC
      LIMIT ${limit}
    `;
  }
}
