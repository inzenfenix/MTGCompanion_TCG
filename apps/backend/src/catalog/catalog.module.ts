import { Module } from '@nestjs/common';
import { CATALOG_REPOSITORY } from './domain/catalog.repository';
import { PrismaCatalogRepository } from './infrastructure/prisma-catalog.repository';
import { CatalogService } from './application/catalog.service';
import { CatalogController } from './presentation/catalog.controller';

@Module({
  controllers: [CatalogController],
  providers: [
    { provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
    CatalogService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
