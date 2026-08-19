import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  COUPON_REPOSITORY,
  type CouponRepository,
} from '../domain/coupon.repository';
import type { CouponEntity } from '../domain/coupon.entity';

/** A user gets one spin every 24h, rolling from their last spin — not a calendar-day reset (ROADMAP.md L1). */
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** A won coupon lapses 7 days after being issued if never redeemed (ROADMAP.md L1). */
const COUPON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The wheel's 3 prize tiers, resolved with the user (ROADMAP.md L1):
 * % off a purchase, capped at a flat $ amount, weighted so the common case
 * is a small discount and the big one is genuinely rare. Weights are
 * relative, not required to sum to 100 — pickTier() normalizes.
 */
export const PRIZE_TIERS: ReadonlyArray<{
  discountPercent: number;
  maxDiscount: number;
  weight: number;
}> = [
  { discountPercent: 5, maxDiscount: 5, weight: 60 },
  { discountPercent: 10, maxDiscount: 10, weight: 30 },
  { discountPercent: 20, maxDiscount: 25, weight: 10 },
];

@Injectable()
export class CouponsService {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
  ) {}

  /**
   * Server-authoritative spin — RNG happens here, never trusts a
   * client-reported win (same reasoning J12's auction resolution is
   * server-authoritative, not client-timed). Rejects a second spin inside
   * the 24h cooldown; the cooldown is derived from the user's own latest
   * coupon row rather than a separate "last spin" timestamp, since every
   * spin already creates one.
   */
  async spin(userId: string): Promise<CouponEntity> {
    const latest = await this.coupons.findLatestForUser(userId);
    if (latest) {
      const nextEligibleAt = new Date(
        latest.createdAt.getTime() + SPIN_COOLDOWN_MS,
      );
      if (nextEligibleAt.getTime() > Date.now()) {
        throw new BadRequestException(
          `Already spun today — next spin available at ${nextEligibleAt.toISOString()}`,
        );
      }
    }

    const tier = pickTier();
    return this.coupons.create({
      issuedToUserId: userId,
      discountPercent: tier.discountPercent,
      maxDiscount: tier.maxDiscount,
      expiresAt: new Date(Date.now() + COUPON_TTL_MS),
    });
  }

  /** Unredeemed, unexpired coupons for a user — feeds L4's checkout coupon picker. */
  listAvailable(userId: string): Promise<CouponEntity[]> {
    return this.coupons.findAvailableForUser(userId);
  }

  /**
   * Validates a coupon is usable by this buyer against this purchase price
   * and returns the discounted amount, WITHOUT marking it redeemed —
   * TransactionsService.create() calls this to price the transaction
   * before the Transaction row (and therefore a real transactionId to
   * redeem against) exists, then calls markRedeemed() once it does. Same
   * NotFoundException whether the coupon is missing or belongs to someone
   * else (CardsService.findOwned()/DecksService.findOwned()'s established
   * pattern) — doesn't confirm a coupon id exists to a non-owner.
   */
  async validateAndPrice(
    couponId: string,
    buyerId: string,
    price: number,
  ): Promise<{ coupon: CouponEntity; discountedAmount: number }> {
    const coupon = await this.coupons.findById(couponId);
    if (!coupon || coupon.issuedToUserId !== buyerId) {
      throw new NotFoundException('Coupon not found');
    }
    if (coupon.redeemedAt) {
      throw new BadRequestException('Coupon already redeemed');
    }
    if (coupon.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Coupon expired');
    }

    const rawDiscount = (price * coupon.discountPercent) / 100;
    const discount = Math.min(rawDiscount, coupon.maxDiscount, price);
    const discountedAmount = Math.round((price - discount) * 100) / 100;
    return { coupon, discountedAmount };
  }

  /** Finalizes a redemption once the transaction it was applied to actually exists. */
  markRedeemed(couponId: string, transactionId: string): Promise<CouponEntity> {
    return this.coupons.markRedeemed(couponId, transactionId);
  }
}

function pickTier() {
  const totalWeight = PRIZE_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const tier of PRIZE_TIERS) {
    if (roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  // Floating-point edge case only (roll landed exactly on totalWeight) —
  // fall back to the last tier rather than returning undefined.
  return PRIZE_TIERS[PRIZE_TIERS.length - 1];
}
