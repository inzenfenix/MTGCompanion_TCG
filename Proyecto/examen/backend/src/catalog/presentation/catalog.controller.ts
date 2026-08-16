import { Controller, Get, Query } from '@nestjs/common';
import { CatalogService } from '../application/catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Public — browsing the real card catalog by name (e.g. for Bazaar
  // search-as-you-type) doesn't require being logged in, same reasoning as
  // GET /cards' ownerId-scoped browse.
  @Get('search')
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.catalog.search(q, limit ? Number(limit) : undefined);
  }
}
