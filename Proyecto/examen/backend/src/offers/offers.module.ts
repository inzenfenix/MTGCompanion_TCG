import { Module } from '@nestjs/common';
import { CardsModule } from '../cards/cards.module';
import { OFFER_REPOSITORY } from './domain/offer.repository';
import { PrismaOfferRepository } from './infrastructure/prisma-offer.repository';
import { OffersService } from './application/offers.service';
import { OffersController } from './presentation/offers.controller';
import { OffersGateway } from './presentation/offers.gateway';

@Module({
  imports: [CardsModule],
  controllers: [OffersController],
  providers: [
    { provide: OFFER_REPOSITORY, useClass: PrismaOfferRepository },
    OffersService,
    OffersGateway,
  ],
  exports: [OffersService],
})
export class OffersModule {}
