import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
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

  // ROADMAP.md L6 — dev-only, no JWT (a global action, not user-scoped).
  // DevOnlyGuard is the actual safety net: 403s unless NODE_ENV !==
  // 'production', so this can never wipe a real deployed backend's coupons.
  @UseGuards(DevOnlyGuard)
  @Delete('dev-reset-all')
  async devResetAll() {
    const count = await this.coupons.devResetAll();
    return { deleted: count };
  }
}
