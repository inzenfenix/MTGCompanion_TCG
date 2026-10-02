import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { OffersService } from '../application/offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';

// Nested under /cards/:cardId — an offer only ever exists in the context of
// one card's auction, same reasoning CardPhoto's routes nest under /cards/:id.
@Controller('cards/:cardId/offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  placeOffer(
    @Param('cardId') cardId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOfferDto,
  ) {
    return this.offers.placeOffer(cardId, user.id, dto.amount);
  }

  // Public, like GET /cards/:id — every connected bidder/seller needs to
  // see the live auction state, not just the ones who've bid. Also the
  // lazy-resolution entry point J12 relies on: any read past closesAt locks
  // in the winner, no cron job needed.
  @Get()
  getAuctionState(@Param('cardId') cardId: string) {
    return this.offers.getAuctionState(cardId);
  }
}
