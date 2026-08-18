import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { CARD_REPOSITORY } from './domain/card.repository';
import { PrismaCardRepository } from './infrastructure/prisma-card.repository';
import { CardsService } from './application/cards.service';
import { CardsController } from './presentation/cards.controller';

@Module({
  // AuthModule is imported only for its exported JwtModule (JwtService) —
  // CardsService.createListingToken/resolveListingToken (J4) sign/verify
  // short-lived QR tokens the same way AuthService signs 2FA challenge
  // tokens, without duplicating JwtModule.registerAsync's config.
  imports: [StorageModule, AuthModule],
  controllers: [CardsController],
  providers: [
    { provide: CARD_REPOSITORY, useClass: PrismaCardRepository },
    CardsService,
  ],
  exports: [CardsService],
})
export class CardsModule {}
