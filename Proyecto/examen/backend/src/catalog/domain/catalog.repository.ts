import type { CatalogCardEntity } from './catalog-card.entity';

/**
 * Port for catalog reads. PrismaCatalogRepository is the sole implementation
 * — CatalogService never sees Prisma directly, same layering as every other
 * module (see cards/domain/card.repository.ts).
 */
export interface CatalogRepository {
  search(query: string, limit: number): Promise<CatalogCardEntity[]>;
  /**
   * ROADMAP.md I19/I25 — fuzzy search against `oracleText` instead of
   * `name`, for `identifyCard.ts`'s combined title+rules-text identify flow:
   * a good rules-text OCR read can find the right card even when the
   * title-bar crop comes out as noise. Always trigram-similarity-based (no
   * `contains`-first attempt like `search()` — a multi-sentence OCR blob
   * matching an oracle text verbatim as a substring is unrealistic).
   */
  searchByText(query: string, limit: number): Promise<CatalogCardEntity[]>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
