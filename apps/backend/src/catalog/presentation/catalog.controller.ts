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

  // ROADMAP.md I19/I25 — the other half of identifyCard.ts's combined
  // title+rules-text identify flow: fuzzy search against oracleText instead
  // of name, for when the rules-text OCR read is good even though the
  // title-bar crop wasn't.
  @Get('search-by-text')
  searchByText(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.catalog.searchByText(q, limit ? Number(limit) : undefined);
  }
}
