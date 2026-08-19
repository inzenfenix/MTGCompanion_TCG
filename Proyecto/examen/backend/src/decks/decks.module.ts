import { Module } from '@nestjs/common';
import { DECK_REPOSITORY } from './domain/deck.repository';
import { PrismaDeckRepository } from './infrastructure/prisma-deck.repository';
import { DecksService } from './application/decks.service';
import { DecksController } from './presentation/decks.controller';

@Module({
  controllers: [DecksController],
  providers: [
    { provide: DECK_REPOSITORY, useClass: PrismaDeckRepository },
    DecksService,
  ],
  // CardsModule imports this to validate a move-target deck's ownership
  // (CardsService.update()) — see that module's own comment.
  exports: [DecksService],
})
export class DecksModule {}
