import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { CouponsService } from '../application/coupons.service';

// No ?ownerId= query param like DecksController's GET /decks — a deck name
// is harmless to browse, a coupon isn't something any other user has a
// legitimate reason to see, so this stays strictly "mine" via the JWT.
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('spin')
  spin(@CurrentUser() user: RequestUser) {
    return this.coupons.spin(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  listMine(@CurrentUser() user: RequestUser) {
    return this.coupons.listAvailable(user.id);
  }
}
