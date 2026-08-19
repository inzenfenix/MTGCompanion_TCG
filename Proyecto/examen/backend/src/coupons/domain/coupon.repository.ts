import type { CouponEntity } from './coupon.entity';

export interface CreateCouponData {
  issuedToUserId: string;
  discountPercent: number;
  maxDiscount: number;
  expiresAt: Date;
}

export interface CouponRepository {
  create(data: CreateCouponData): Promise<CouponEntity>;
  findById(id: string): Promise<CouponEntity | null>;
  /** Most recently issued coupon for a user, regardless of tier or redemption state — the once-per-day spin gate reads this. */
  findLatestForUser(userId: string): Promise<CouponEntity | null>;
  /** Unredeemed, unexpired coupons for a user — what a checkout coupon picker (L4) offers. */
  findAvailableForUser(userId: string): Promise<CouponEntity[]>;
  markRedeemed(id: string, transactionId: string): Promise<CouponEntity>;
  /** ROADMAP.md L6 — dev-only, wipes every Coupon row (all accounts) so a local test session can re-spin without waiting out the 24h cooldown. Returns the number of rows deleted. */
  deleteAll(): Promise<number>;
}

export const COUPON_REPOSITORY = Symbol('COUPON_REPOSITORY');
