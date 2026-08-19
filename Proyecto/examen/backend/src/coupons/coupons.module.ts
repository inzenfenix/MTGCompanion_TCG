import { Module } from '@nestjs/common';
import { COUPON_REPOSITORY } from './domain/coupon.repository';
import { PrismaCouponRepository } from './infrastructure/prisma-coupon.repository';
import { CouponsService } from './application/coupons.service';
import { CouponsController } from './presentation/coupons.controller';

@Module({
  controllers: [CouponsController],
  providers: [
    { provide: COUPON_REPOSITORY, useClass: PrismaCouponRepository },
    CouponsService,
  ],
  // TransactionsModule imports this to price+redeem a coupon inside
  // TransactionsService.create() — see that module's own comment.
  exports: [CouponsService],
})
export class CouponsModule {}
