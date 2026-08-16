import type { CatalogCardEntity } from './catalog-card.entity';

/**
 * Port for catalog reads. PrismaCatalogRepository is the sole implementation
 * — CatalogService never sees Prisma directly, same layering as every other
 * module (see cards/domain/card.repository.ts).
 */
export interface CatalogRepository {
  search(query: string, limit: number): Promise<CatalogCardEntity[]>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
