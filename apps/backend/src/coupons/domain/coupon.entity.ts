/**
 * ROADMAP.md L — a spin-the-wheel prize. `discountPercent`/`maxDiscount`
 * are frozen at issuance time (L1/L2's resolved shape: % off a purchase,
 * capped at a flat $ amount) so a future prize-tier rebalance never
 * retroactively changes a coupon a user already won. `redeemedAt`/
 * `redeemedInTransactionId` are both null or both set together — see
 * schema.prisma's own Coupon comment for why that's enforced at the
 * database level (Transaction's 1-1 optional relation), not just here.
 */
export interface CouponEntity {
  id: string;
  issuedToUserId: string;
  discountPercent: number;
  maxDiscount: number;
  redeemedAt: Date | null;
  redeemedInTransactionId: string | null;
  expiresAt: Date;
  createdAt: Date;
}
