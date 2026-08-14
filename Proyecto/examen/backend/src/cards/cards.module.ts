import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CARD_REPOSITORY } from './domain/card.repository';
import { PrismaCardRepository } from './infrastructure/prisma-card.repository';
import { CardsService } from './application/cards.service';
import { CardsController } from './presentation/cards.controller';

@Module({
  imports: [StorageModule],
  controllers: [CardsController],
  providers: [
    { provide: CARD_REPOSITORY, useClass: PrismaCardRepository },
    CardsService,
  ],
  exports: [CardsService],
})
export class CardsModule {}
