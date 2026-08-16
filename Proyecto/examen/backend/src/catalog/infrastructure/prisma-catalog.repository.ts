import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CatalogRepository } from '../domain/catalog.repository';
import type { CatalogCardEntity } from '../domain/catalog-card.entity';

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Plain `contains`/insensitive rather than a trigram index — catalog_cards
  // is ~58k rows, small enough that a sequential scan is fast in practice
  // for a course-project demo; a pg_trgm GIN index would be the real fix if
  // this ever needs to scale, not attempted here (no other part of this
  // project uses Postgres extensions beyond the plain ones Prisma manages).
  async search(query: string, limit: number): Promise<CatalogCardEntity[]> {
    return this.prisma.catalogCard.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      orderBy: [
        { edhrecRank: { sort: 'asc', nulls: 'last' } },
        { name: 'asc' },
      ],
      take: limit,
    });
  }
}
